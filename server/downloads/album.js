/**
 * Album + playlist orchestration for library modes (server port of the album/playlist
 * download logic in src/utils/albumDownload.ts).
 *
 * Ports: existing-track skip (server/index.js check-tracks logic), multi-artist detection,
 * playlist album-artist resolution (fetches album detail through the allowlisted fetcher),
 * per-track folder layout, and m3u generation (server/index.js handleLibraryPlaylist logic).
 *
 * Processing is headless: on a track failure it retries once, then marks the track failed
 * and continues with the rest (Req 5.5). Progress and per-track status are surfaced through
 * the `ctx` hooks provided by the worker.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { getDb } from '../db/index.js';
import { fetchAllowed } from './fetcher.js';
import { sanitizeFilename } from './decrypt.js';
import { processTrack, writeToLibrary, sanitizePathSegment } from './engine.js';
import { recordTrack } from './recorder.js';

const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';
const DETAIL_API = 'https://sda.rhythmax.workers.dev/album';

// ─── Artist helpers (mirror albumDownload.ts getArtistT / detectMultiArtist) ─

/** Album/playlist track artist (mirrors albumDownload.ts getArtistT). */
export function getArtistName(song) {
  return (
    song.subtitle?.split(' - ')[0]?.trim() ||
    song.more_info?.artists?.primary?.[0]?.name ||
    'Unknown Artist'
  );
}

/**
 * Detect whether an album spans multiple artists and suggest a unified Album Artist
 * (Navidrome fix). Port of albumDownload.ts detectMultiArtist.
 */
export function detectMultiArtist(album) {
  const artistSet = new Set();
  for (const song of album.songs) {
    artistSet.add(getArtistName(song).toLowerCase().trim());
  }
  const uniqueArtists = [...new Set(album.songs.map((s) => getArtistName(s)))];
  const isMultiArtist = artistSet.size > 1;

  let suggestedAlbumArtist = 'Various Artists';
  if (album.artists?.primary?.length === 1) {
    suggestedAlbumArtist = album.artists.primary[0].name;
  } else if (album.artists?.primary?.length > 1) {
    suggestedAlbumArtist = album.artists.primary.map((a) => a.name).join(', ');
  }

  return { isMultiArtist, uniqueArtists, suggestedAlbumArtist };
}

// ─── Existing-track check (server port of handleLibraryCheckTracks) ──────────

/**
 * Which of the given saavn ids already exist on disk (staging or music path).
 * @returns {Record<string, { filePath: string, exists: boolean }>}
 */
export function checkExistingTracks(saavnIds) {
  if (!Array.isArray(saavnIds) || saavnIds.length === 0) return {};
  const db = getDb();
  const placeholders = saavnIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT saavn_id, file_path FROM tracks WHERE saavn_id IN (${placeholders})`).all(...saavnIds);

  const existing = {};
  for (const row of rows) {
    if (!row.file_path) continue;
    const libraryFullPath = LIBRARY_PATH ? join(LIBRARY_PATH, row.file_path) : '';
    const musicFullPath = MUSIC_PATH ? join(MUSIC_PATH, row.file_path) : '';
    const fileExists = (libraryFullPath && existsSync(libraryFullPath)) || (musicFullPath && existsSync(musicFullPath));
    existing[row.saavn_id] = { filePath: row.file_path, exists: !!fileExists };
  }
  return existing;
}

// ─── Playlist album-artist resolution (port of resolveAlbumArtists) ──────────

/**
 * Fetch album details for each unique album_id to resolve the correct album artist
 * (so playlist tracks land in the same folder as a full-album download).
 * @returns {Promise<Map<string, { albumArtist: string, year: string }>>}
 */
export async function resolveAlbumArtists(songs, signal) {
  const map = new Map();

  const albumUrls = new Map();
  for (const song of songs) {
    const albumId = song.more_info?.album_id;
    const albumUrl = song.more_info?.album_url;
    if (albumId && albumUrl && !albumUrls.has(albumId)) albumUrls.set(albumId, albumUrl);
  }

  const entries = [...albumUrls.entries()];
  const BATCH_SIZE = 5;

  for (let batch = 0; batch < entries.length; batch += BATCH_SIZE) {
    if (signal?.aborted) break;
    const chunk = entries.slice(batch, batch + BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async ([albumId, albumUrl]) => {
        try {
          const buf = await fetchAllowed(`${DETAIL_API}?url=${encodeURIComponent(albumUrl)}`, { signal });
          const detail = JSON.parse(buf.toString('utf-8'));
          if (!detail?.id) return null;

          let albumArtist;
          if (detail.artists?.primary?.length === 1) {
            albumArtist = detail.artists.primary[0].name;
          } else if (detail.artists?.primary?.length > 1) {
            albumArtist = detail.artists.primary.map((a) => a.name).join(', ');
          } else {
            albumArtist = detail.subtitle?.split(' - ')[0]?.trim() || '';
          }
          return { albumId, albumArtist, year: detail.year || '' };
        } catch {
          return null;
        }
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { albumId, albumArtist, year } = result.value;
        map.set(albumId, { albumArtist, year });
      }
    }
  }

  return map;
}

// ─── m3u generation (server port of handleLibraryPlaylist) ───────────────────

/**
 * Create/refresh a playlist row, link its tracks, and write the .m3u to
 * MUSIC_PATH/Playlists and LIBRARY_PATH/Playlists.
 * @returns {Promise<string>} the relative path written (or '')
 */
export async function createPlaylistFile(name, tracks) {
  const db = getDb();
  const now = new Date().toISOString();

  let playlist = db.prepare('SELECT id FROM playlists WHERE name = ?').get(name);
  if (!playlist) {
    const playlistId = randomUUID();
    db.prepare(
      `INSERT INTO playlists (id, name, description, auto_generate, auto_criteria, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?)`,
    ).run(playlistId, name, 'Downloaded from JioSaavn', now, now);
    playlist = { id: playlistId };
  } else {
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlist.id);
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id);
  }

  const findTrack = db.prepare('SELECT id FROM tracks WHERE saavn_id = ?');
  const insertLink = db.prepare(
    `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track.saavnId) continue;
      const dbTrack = findTrack.get(track.saavnId);
      if (dbTrack) insertLink.run(playlist.id, dbTrack.id, i, now);
    }
  })();

  const musicPrefix = MUSIC_PATH ? (MUSIC_PATH.endsWith('/') ? MUSIC_PATH : MUSIC_PATH + '/') : '';
  let m3u = '#EXTM3U\n';
  m3u += `#PLAYLIST:${name}\n`;
  for (const track of tracks) {
    const duration = Math.round(track.duration || 0);
    const display = track.artist ? `${track.artist} - ${track.title}` : track.title;
    m3u += `#EXTINF:${duration},${display}\n`;
    m3u += `${musicPrefix}${track.filePath}\n`;
  }

  const targets = [MUSIC_PATH, LIBRARY_PATH].filter(Boolean);
  const safeName = sanitizePathSegment(name);
  let writtenPath = '';
  for (const base of targets) {
    const playlistDir = join(base, 'Playlists');
    await mkdir(playlistDir, { recursive: true });
    const playlistPath = join(playlistDir, `${safeName}.m3u`);
    if (!resolve(playlistPath).startsWith(resolve(base))) continue;
    await writeFile(playlistPath, m3u, 'utf-8');
    if (!writtenPath) writtenPath = `Playlists/${safeName}.m3u`;
  }

  return writtenPath;
}

// ─── Shared per-track processing with headless retry ─────────────────────────

/**
 * Download + save one track to the library with a single retry.
 * @returns {Promise<{ ok: boolean, filePath?: string, error?: string }>}
 */
async function downloadTrackToLibrary(song, quality, { jobId, signal, artist, albumArtist, folderArtist, albumFolder, filename, onProgress }) {
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error('Aborted');
    try {
      const buffer = await processTrack(song, quality, {
        jobId,
        signal,
        artist,
        albumArtist,
        onProgress,
      });
      const savedPath = await writeToLibrary(buffer, folderArtist, albumFolder, filename);
      return { ok: true, filePath: savedPath };
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err instanceof Error ? err.message : 'Unknown error';
    }
  }
  return { ok: false, error: lastErr };
}

/**
 * Download + tag one track into an in-memory Buffer with a single retry
 * (browser-delivery / zip modes — no library write).
 * @returns {Promise<{ ok: boolean, buffer?: Buffer, error?: string }>}
 */
async function downloadTrackToBuffer(song, quality, { jobId, signal, artist, albumArtist, onProgress }) {
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error('Aborted');
    try {
      const buffer = await processTrack(song, quality, { jobId, signal, artist, albumArtist, onProgress });
      return { ok: true, buffer };
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err instanceof Error ? err.message : 'Unknown error';
    }
  }
  return { ok: false, error: lastErr };
}

// ─── Album (library) ─────────────────────────────────────────────────────────

/**
 * Process an album job in library mode.
 * @param {object} album      AlbumDetail
 * @param {string} quality
 * @param {object} ctx        { jobId, signal, albumArtistOverride, setTrack, setProgress }
 * @returns {Promise<Array>}  per-track results for the album history record
 */
export async function processAlbumLibrary(album, quality, ctx) {
  const { jobId, signal, albumArtistOverride, setTrack, setProgress } = ctx;
  const songs = album.songs || [];
  const albumFolder = `${sanitizeFilename(album.title)} (${album.year})`;

  setProgress(0, 'Checking existing tracks…');
  const existingMap = checkExistingTracks(songs.map((s) => s.id));

  const results = [];

  for (let i = 0; i < songs.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const song = songs[i];
    const artistName = getArtistName(song);
    const existing = existingMap[song.id];

    if (existing?.exists && existing.filePath) {
      setTrack(i, { status: 'done', filePath: existing.filePath });
      setProgress(Math.round(((i + 1) / songs.length) * 100), 'Already in library ✓');
      results.push({ song, status: 'done', filePath: existing.filePath, artist: artistName });
      continue;
    }

    setTrack(i, { status: 'downloading' });
    const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(song.title)} - ${sanitizeFilename(artistName)}.m4a`;
    const folderArtist = albumArtistOverride || album.artists?.primary?.[0]?.name || artistName;
    const albumArtistTag = albumArtistOverride || artistName;

    const res = await downloadTrackToLibrary(song, quality, {
      jobId,
      signal,
      artist: artistName,
      albumArtist: albumArtistTag,
      folderArtist,
      albumFolder,
      filename,
      onProgress: (stage, p) => setProgress(Math.round(((i + p / 100) / songs.length) * 100), stage),
    });

    if (res.ok) {
      setTrack(i, { status: 'done', filePath: res.filePath });
      results.push({ song, status: 'done', filePath: res.filePath, artist: artistName });
      recordTrack({
        saavnId: song.id,
        title: song.title,
        artist: artistName,
        album: album.title,
        image: song.image || '',
        quality,
        mode: 'library',
        songCount: 0,
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year: song.year || album.year || '',
        language: song.language || album.language || '',
        isExplicit: song.isExplicit || false,
        filePath: res.filePath,
      });
    } else {
      setTrack(i, { status: 'failed', error: res.error });
      results.push({ song, status: 'failed', error: res.error, artist: artistName });
    }
  }

  setProgress(100, 'Done!');
  return results;
}

// ─── Playlist (library) ────────────────────────────────────────────────────

/**
 * Process a playlist job in library mode: per-track Artist/Album folders, skip existing,
 * generate an m3u.
 * @returns {Promise<Array>} per-track results for the album (playlist) history record
 */
export async function processPlaylistLibrary(album, quality, ctx) {
  const { jobId, signal, setTrack, setProgress } = ctx;
  const songs = album.songs || [];

  setProgress(0, 'Checking existing tracks…');
  const existingMap = checkExistingTracks(songs.map((s) => s.id));

  setProgress(1, 'Resolving album artists…');
  const albumArtistMap = await resolveAlbumArtists(songs, signal);

  const results = [];
  const playlistTracks = [];

  for (let i = 0; i < songs.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const song = songs[i];
    const artistName = getArtistName(song);
    const albumId = song.more_info?.album_id || '';
    const albumInfo = albumArtistMap.get(albumId);
    const existing = existingMap[song.id];

    if (existing?.exists && existing.filePath) {
      setTrack(i, { status: 'done', filePath: existing.filePath });
      playlistTracks.push({
        saavnId: song.id,
        title: song.title,
        artist: artistName,
        duration: parseInt(song.more_info?.duration || '0', 10),
        filePath: existing.filePath,
      });
      results.push({ song, status: 'done', filePath: existing.filePath, artist: artistName });
      setProgress(Math.round(((i + 1) / songs.length) * 95), 'Already in library ✓');
      continue;
    }

    setTrack(i, { status: 'downloading' });

    const folderArtist = albumInfo?.albumArtist || artistName;
    const albumArtistTag = albumInfo?.albumArtist || artistName;
    const trackAlbum = song.more_info?.album || album.title;
    const trackYear = song.year || albumInfo?.year || '';
    const albumFolder = `${sanitizeFilename(trackAlbum)}${trackYear ? ` (${trackYear})` : ''}`;
    const filename = `${sanitizeFilename(song.title)} - ${sanitizeFilename(artistName)}.m4a`;

    const res = await downloadTrackToLibrary(song, quality, {
      jobId,
      signal,
      artist: artistName,
      albumArtist: albumArtistTag,
      folderArtist,
      albumFolder,
      filename,
      onProgress: (stage, p) => setProgress(Math.round(((i + p / 100) / songs.length) * 95), stage),
    });

    if (res.ok) {
      setTrack(i, { status: 'done', filePath: res.filePath });
      playlistTracks.push({
        saavnId: song.id,
        title: song.title,
        artist: artistName,
        duration: parseInt(song.more_info?.duration || '0', 10),
        filePath: res.filePath,
      });
      results.push({ song, status: 'done', filePath: res.filePath, artist: artistName, albumTitle: trackAlbum, year: trackYear });
      recordTrack({
        saavnId: song.id,
        title: song.title,
        artist: artistName,
        album: trackAlbum,
        image: song.image || '',
        quality,
        mode: 'library',
        songCount: 0,
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year: song.year || trackYear,
        language: song.language || '',
        isExplicit: song.isExplicit || false,
        filePath: res.filePath,
      });
    } else {
      setTrack(i, { status: 'failed', error: res.error });
      results.push({ song, status: 'failed', error: res.error, artist: artistName });
    }
  }

  if (playlistTracks.length > 0) {
    setProgress(96, 'Creating playlist file…');
    try {
      await createPlaylistFile(album.title, playlistTracks);
    } catch (err) {
      console.error('[downloads/album] playlist file creation failed:', err.message);
    }
  }

  setProgress(100, 'Done!');
  return results;
}


// ─── Album / playlist archive (browser-delivery: zip / individual) ───────────

/**
 * Process an album/playlist job into a single ZIP archive Buffer (browser-delivery).
 * Album "individual" mode is also delivered as a single zip (Req 7.5). Tracks keep their
 * own metadata; the unified Album Artist tag (Navidrome fix) is applied when provided.
 *
 * @param {object} album      AlbumDetail
 * @param {string} quality
 * @param {object} ctx        { jobId, signal, albumArtistOverride, setTrack, setProgress }
 * @returns {Promise<{ buffer: Buffer, filename: string, results: Array }>}
 */
export async function processAlbumArchive(album, quality, ctx) {
  const { jobId, signal, albumArtistOverride, setTrack, setProgress } = ctx;
  const songs = album.songs || [];
  const folderName = sanitizeFilename(`${album.title} (${album.year})`);

  const zip = new JSZip();
  const folder = zip.folder(folderName) || zip;
  const results = [];

  for (let i = 0; i < songs.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const song = songs[i];
    const artistName = getArtistName(song);

    setTrack(i, { status: 'downloading' });
    // Reserve the last 8% of the bar for zip assembly.
    const res = await downloadTrackToBuffer(song, quality, {
      jobId,
      signal,
      artist: artistName,
      albumArtist: albumArtistOverride || artistName,
      onProgress: (stage, p) => setProgress(Math.round(((i + p / 100) / songs.length) * 92), stage),
    });

    if (res.ok) {
      const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(song.title)} - ${sanitizeFilename(artistName)}.m4a`;
      folder.file(filename, res.buffer);
      setTrack(i, { status: 'done' });
      results.push({ song, status: 'done', artist: artistName });
    } else {
      setTrack(i, { status: 'failed', error: res.error });
      results.push({ song, status: 'failed', error: res.error, artist: artistName });
    }
  }

  if (signal?.aborted) throw new Error('Aborted');

  setProgress(94, 'Building ZIP…');
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }, (meta) => {
    setProgress(94 + Math.round(meta.percent * 0.05), `Compressing ${meta.percent.toFixed(0)}%…`);
  });

  const filename = `${sanitizeFilename(album.title)} (${album.year}).zip`;
  setProgress(100, 'Done!');
  return { buffer, filename, results };
}
