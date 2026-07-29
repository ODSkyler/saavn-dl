/**
 * Server-side single-track download engine.
 *
 * Port of the client pipeline (src/utils/download.ts `downloadWithMetadata` /
 * src/utils/albumDownload.ts `trackToBlob`): decrypt the media URL, fetch audio + cover
 * through the allowlisted fetcher, and embed metadata + cover art with the native ffmpeg
 * binary (falling back to metadata-only if the cover embed fails). Returns a Buffer.
 *
 * `writeToLibrary` mirrors server/index.js `handleLibrarySave`: same sanitization and
 * resolved-path-within-SAAVN_LIBRARY_PATH guard, producing the Artist/Album (Year)/Track.m4a
 * layout.
 */

import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { decryptMediaUrl, getQualityUrl } from './decrypt.js';
import { fetchAllowed } from './fetcher.js';
import { runFfmpeg, ensureJobTempDir, jobTempDir } from './ffmpeg.js';

const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';

const EMBED_COVER_TIMEOUT_MS = 90_000;
const EMBED_META_TIMEOUT_MS = 45_000;
const MIN_AUDIO_BYTES = 1024;
const MIN_COVER_BYTES = 500;

// ─── Metadata helpers (mirror the client) ───────────────────────────────────

/** Primary artist string for a song (mirrors download.ts getArtistTag). */
export function getArtistTag(song) {
  const fromSubtitle = song.subtitle?.split(' - ')[0]?.trim();
  if (fromSubtitle) return fromSubtitle;
  const fromPrimary = song.more_info?.artists?.primary?.map((a) => a.name).join(', ');
  return fromPrimary || 'Unknown Artist';
}

/** 500x500 https cover URL (mirrors download.ts getImageUrl). */
export function getImageUrl(song) {
  return (song.image || '').replace(/\d+x\d+/, '500x500').replace('http://', 'https://');
}

function validateOutput(buf, label) {
  if (!buf || buf.byteLength < MIN_AUDIO_BYTES) {
    throw new Error(`${label}: output too small (${buf ? buf.byteLength : 0} bytes) — likely empty`);
  }
  return buf;
}

// ─── ffmpeg arg builders (mirror the client arg lists) ──────────────────────

function metadataArgs(meta) {
  const args = [];
  args.push('-metadata', `title=${meta.title ?? ''}`);
  args.push('-metadata', `artist=${meta.artist ?? ''}`);
  if (meta.albumArtist) args.push('-metadata', `album_artist=${meta.albumArtist}`);
  args.push('-metadata', `album=${meta.album ?? ''}`);
  args.push('-metadata', `date=${meta.year ?? ''}`);
  if (meta.publisher) args.push('-metadata', `publisher=${meta.publisher}`);
  if (meta.copyright) args.push('-metadata', `copyright=${meta.copyright}`);
  return args;
}

// ─── Core: process a single track into a Buffer ─────────────────────────────

/**
 * Download, tag, and return a fully-processed .m4a as a Buffer.
 *
 * @param {object} song       SaavnSong (needs more_info.encrypted_media_url, image, etc.)
 * @param {string} quality    e.g. '320'
 * @param {object} [opts]
 * @param {string} opts.jobId            temp workspace scope
 * @param {AbortSignal} [opts.signal]    cancels fetch + ffmpeg
 * @param {(stage:string, pct:number)=>void} [opts.onProgress]
 * @param {string} [opts.albumArtist]    embed an album_artist tag (album/playlist modes)
 * @param {string} [opts.artist]         override the artist tag / album_artist default
 * @param {string} [opts.publisher]      embed a publisher tag (single-track mode)
 * @param {string} [opts.copyright]      embed a copyright tag (single-track mode)
 * @param {object} [opts.overrideMeta]   { title, artist, album, year, copyright } overrides
 * @returns {Promise<Buffer>}
 */
export async function processTrack(song, quality, opts = {}) {
  const { jobId = 'adhoc', signal, onProgress = () => {}, albumArtist, publisher, copyright, overrideMeta } = opts;
  const { more_info } = song;

  if (signal?.aborted) throw new Error('Aborted');

  onProgress('Decrypting…', 8);
  const decrypted = decryptMediaUrl(more_info.encrypted_media_url);
  const audioUrl = getQualityUrl(decrypted, quality);

  onProgress('Fetching audio…', 20);
  const audioBuf = await fetchAllowed(audioUrl, { signal });
  if (!audioBuf || audioBuf.byteLength < MIN_AUDIO_BYTES) {
    throw new Error('Audio response is empty — URL may have expired');
  }

  onProgress('Fetching cover…', 35);
  let coverBuf = null;
  try {
    const buf = await fetchAllowed(getImageUrl(song), { signal });
    if (buf && buf.byteLength > MIN_COVER_BYTES) coverBuf = buf;
  } catch {
    // cover is optional
  }

  if (signal?.aborted) throw new Error('Aborted');

  const artist = opts.artist || getArtistTag(song);
  const meta = overrideMeta
    ? {
        title: overrideMeta.title,
        artist: overrideMeta.artist,
        albumArtist: albumArtist || overrideMeta.albumArtist,
        album: overrideMeta.album,
        year: overrideMeta.year,
        publisher: publisher || more_info.label,
        copyright: overrideMeta.copyright || copyright,
      }
    : {
        title: song.title,
        artist,
        albumArtist,
        album: more_info.album,
        year: song.year,
        publisher,
        copyright,
      };

  const dir = await ensureJobTempDir(jobId);
  const inF = join(dir, `in_${song.id}.mp4`);
  const covF = join(dir, `cov_${song.id}.jpg`);
  const outF = join(dir, `out_${song.id}.m4a`);

  const cleanup = async () => {
    for (const f of [inF, covF, outF]) {
      try { await unlink(f); } catch { /* ignore */ }
    }
  };

  try {
    await writeFile(inF, audioBuf);

    if (coverBuf) {
      await writeFile(covF, coverBuf);
      onProgress('Embedding cover + metadata…', 65);
      const coverArgs = [
        '-i', inF,
        '-i', covF,
        '-map', '0:a:0',
        '-map', '1:v:0',
        '-c:a', 'copy',
        '-c:v', 'copy',
        '-disposition:v:0', 'attached_pic',
        ...metadataArgs(meta),
        '-movflags', '+faststart',
        outF,
      ];
      try {
        await runFfmpeg(coverArgs, { signal, timeoutMs: EMBED_COVER_TIMEOUT_MS });
      } catch (err) {
        if (signal?.aborted) throw err;
        // Cover embed failed — retry metadata-only (mirrors client fallback).
        console.warn('[downloads/engine] cover embed failed, retrying without cover:', err.message);
        onProgress('Cover failed, embedding metadata only…', 72);
        try { await unlink(outF); } catch { /* ignore */ }
        const metaArgs = ['-i', inF, '-c', 'copy', ...metadataArgs(meta), '-movflags', '+faststart', outF];
        await runFfmpeg(metaArgs, { signal, timeoutMs: EMBED_META_TIMEOUT_MS });
      }
    } else {
      onProgress('Embedding metadata…', 65);
      const metaArgs = ['-i', inF, '-c', 'copy', ...metadataArgs(meta), '-movflags', '+faststart', outF];
      await runFfmpeg(metaArgs, { signal, timeoutMs: EMBED_META_TIMEOUT_MS });
    }

    const outBuf = validateOutput(await readFile(outF), 'output');
    onProgress('Done', 95);
    return outBuf;
  } finally {
    await cleanup();
  }
}

// ─── Library write (mirrors handleLibrarySave) ──────────────────────────────

/** Same sanitization as server/index.js sanitizePathSegment. */
export function sanitizePathSegment(segment) {
  return String(segment)
    .replace(/\.\./g, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 255);
}

export function isLibraryConfigured() {
  return !!LIBRARY_PATH;
}

/**
 * Write a processed track buffer into the library using the same
 * Artist/Album (Year)/Track.m4a layout and path-traversal guard as
 * handleLibrarySave. `album` is expected to already include the "(Year)" suffix.
 *
 * @returns {Promise<string>} the relative path stored (Artist/Album/filename)
 */
export async function writeToLibrary(buffer, artist, album, filename) {
  if (!LIBRARY_PATH) throw new Error('Library saving is not configured');

  const safeArtist = artist ? sanitizePathSegment(artist) : '';
  const safeAlbum = sanitizePathSegment(album || 'Unknown Album');
  const safeFilename = sanitizePathSegment(filename);

  if (!safeFilename) throw new Error('Invalid filename');

  const targetDir = safeArtist
    ? join(LIBRARY_PATH, safeArtist, safeAlbum)
    : join(LIBRARY_PATH, safeAlbum);
  await mkdir(targetDir, { recursive: true });

  const targetPath = join(targetDir, safeFilename);
  const resolvedTarget = resolve(targetPath);
  const resolvedBase = resolve(LIBRARY_PATH);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    throw new Error('Invalid path');
  }

  await writeFile(targetPath, buffer);

  return safeArtist
    ? `${safeArtist}/${safeAlbum}/${safeFilename}`
    : `${safeAlbum}/${safeFilename}`;
}

export { jobTempDir };
