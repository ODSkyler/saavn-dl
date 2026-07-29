/**
 * Lightweight production server for saavn-dl.
 * Serves the Vite build output and provides an API for "Save to Library"
 * functionality when the SAAVN_LIBRARY_PATH env var is set.
 *
 * Endpoints:
 *   GET  /api/config         → { libraryEnabled: boolean }
 *   POST /api/library/save   → saves uploaded file to SAAVN_LIBRARY_PATH/<album>/<filename>
 *
 * All other requests fall through to static file serving (SPA with index.html fallback).
 */

import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { initDb, getDb } from './db/index.js';
import { handleLibraryRoute } from './library/routes.js';
import { handleHistoryRoute } from './history/routes.js';
import { handlePlaylistRoute } from './playlists/routes.js';
import { handleProxyRoute } from './proxy.js';
import { initScheduler } from './library/sync-scheduler.js';
import { backfillFilePaths } from './playlists/store.js';
import { handleDownloadsRoute } from './downloads/routes.js';
import { probeFfmpeg } from './downloads/ffmpeg.js';
import { downloadWorker } from './downloads/queue.js';

const PORT = parseInt(process.env.PORT || '80', 10);
const STATIC_DIR = resolve(process.env.STATIC_DIR || './dist');
const LIBRARY_PATH = process.env.SAAVN_LIBRARY_PATH || '';
const MUSIC_PATH = process.env.SAAVN_MUSIC_PATH || '';
const DB_PATH = process.env.SAAVN_DB_PATH || './data/saavn-dl.db';
const FORCE_PROXY = process.env.SAAVN_FORCE_PROXY === 'true' || process.env.SAAVN_FORCE_PROXY === '1';

// Set once at startup after the ffmpeg probe (see startup()). Server-side downloads
// require both a library destination and a working ffmpeg binary.
let serverDownloadsEnabled = false;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}

function jsonResponse(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sanitizePathSegment(segment) {
  // Remove path traversal attempts and invalid filesystem chars
  return segment
    .replace(/\.\./g, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 255);
}

async function parseMultipartBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_SIZE = 100 * 1024 * 1024; // 100 MB limit per file

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(new Error('File too large (max 100 MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────

async function handleApiConfig(req, res) {
  jsonResponse(res, 200, {
    libraryEnabled: !!LIBRARY_PATH,
    musicPathEnabled: !!MUSIC_PATH,
    historyEnabled: true,
    playlistsEnabled: true,
    dbEnabled: true,
    dbPath: DB_PATH,
    forceProxy: FORCE_PROXY,
    serverDownloadsEnabled,
  });
}

async function handleLibrarySave(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  // Expect raw binary body with metadata in headers (URI-encoded for non-ASCII safety)
  const artist = decodeURIComponent(req.headers['x-artist'] || '');
  const album = decodeURIComponent(req.headers['x-album'] || 'Unknown Album');
  const filename = decodeURIComponent(req.headers['x-filename'] || '');

  if (!filename) {
    return jsonResponse(res, 400, { error: 'Missing x-filename header' });
  }

  const safeArtist = artist ? sanitizePathSegment(artist) : '';
  const safeAlbum = sanitizePathSegment(album);
  const safeFilename = sanitizePathSegment(filename);

  if (!safeFilename) {
    return jsonResponse(res, 400, { error: 'Invalid filename' });
  }

  try {
    const body = await parseMultipartBody(req);

    // Build path: Artist/Album/Track (or Album/Track if no artist provided)
    const targetDir = safeArtist
      ? join(LIBRARY_PATH, safeArtist, safeAlbum)
      : join(LIBRARY_PATH, safeAlbum);
    await mkdir(targetDir, { recursive: true });

    const targetPath = join(targetDir, safeFilename);

    // Prevent path traversal (resolved path must be inside LIBRARY_PATH)
    const resolvedTarget = resolve(targetPath);
    const resolvedBase = resolve(LIBRARY_PATH);
    if (!resolvedTarget.startsWith(resolvedBase)) {
      return jsonResponse(res, 400, { error: 'Invalid path' });
    }

    await writeFile(targetPath, body);

    const relativePath = safeArtist
      ? `${safeArtist}/${safeAlbum}/${safeFilename}`
      : `${safeAlbum}/${safeFilename}`;

    jsonResponse(res, 200, {
      success: true,
      path: relativePath,
    });
  } catch (err) {
    console.error('[library/save] Error:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * POST /api/library/check-tracks
 * Body: { saavnIds: string[] }
 * Returns: { existing: { [saavnId]: { filePath: string, exists: boolean } } }
 *
 * Checks which tracks already exist in the library (by saavn_id in the DB + file on disk).
 */
async function handleLibraryCheckTracks(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  try {
    const body = await parseJsonBody(req);
    const saavnIds = body?.saavnIds;
    if (!Array.isArray(saavnIds) || saavnIds.length === 0) {
      return jsonResponse(res, 400, { error: 'saavnIds array required' });
    }

    const db = getDb();

    // Look up existing tracks by saavn_id
    const placeholders = saavnIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT saavn_id, file_path FROM tracks WHERE saavn_id IN (${placeholders})`).all(...saavnIds);

    const existing = {};
    for (const row of rows) {
      if (row.file_path) {
        // Check if file exists on disk — try both library (staging) and music (final) paths
        const libraryFullPath = join(LIBRARY_PATH, row.file_path);
        const musicFullPath = MUSIC_PATH ? join(MUSIC_PATH, row.file_path) : '';
        const fileExists = existsSync(libraryFullPath) || (musicFullPath && existsSync(musicFullPath));
        existing[row.saavn_id] = { filePath: row.file_path, exists: fileExists };
      }
    }

    jsonResponse(res, 200, { existing });
  } catch (err) {
    console.error('[library/check-tracks] Error:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * POST /api/library/playlist
 * Body: { name: string, tracks: { saavnId: string, title: string, artist: string, duration: number, filePath: string }[] }
 * Returns: { success: true, playlistId: string, path: string }
 *
 * Creates a playlist entry in the database and generates an m3u file.
 * The m3u uses SAAVN_MUSIC_PATH-prefixed absolute paths so it works after sync.
 * Also links tracks to the playlist in playlist_tracks table.
 */
async function handleLibraryPlaylist(req, res) {
  if (!LIBRARY_PATH) {
    return jsonResponse(res, 403, { error: 'Library saving is not configured' });
  }

  try {
    const body = await parseJsonBody(req);
    const { name, tracks } = body || {};

    if (!name || !Array.isArray(tracks) || tracks.length === 0) {
      return jsonResponse(res, 400, { error: 'name and tracks array required' });
    }

    const db = getDb();
    const { randomUUID } = await import('node:crypto');

    // Create or get the playlist entry in the DB
    let playlist = db.prepare('SELECT id FROM playlists WHERE name = ?').get(name);
    const now = new Date().toISOString();

    if (!playlist) {
      const playlistId = randomUUID();
      db.prepare(`
        INSERT INTO playlists (id, name, description, auto_generate, auto_criteria, created_at, updated_at)
        VALUES (?, ?, ?, 0, '', ?, ?)
      `).run(playlistId, name, `Downloaded from JioSaavn`, now, now);
      playlist = { id: playlistId };
    } else {
      // Update timestamp
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlist.id);
      // Clear existing track links (rebuild from scratch)
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id);
    }

    // Link tracks to the playlist by saavn_id
    const findTrack = db.prepare('SELECT id FROM tracks WHERE saavn_id = ?');
    const insertLink = db.prepare(`
      INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at)
      VALUES (?, ?, ?, ?)
    `);

    const linkAll = db.transaction(() => {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (!track.saavnId) continue;
        const dbTrack = findTrack.get(track.saavnId);
        if (dbTrack) {
          insertLink.run(playlist.id, dbTrack.id, i, now);
        }
      }
    });
    linkAll();

    // Build m3u with absolute paths (using MUSIC_PATH where files end up after sync)
    const musicPrefix = MUSIC_PATH ? (MUSIC_PATH.endsWith('/') ? MUSIC_PATH : MUSIC_PATH + '/') : '';

    let m3u = '#EXTM3U\n';
    m3u += `#PLAYLIST:${name}\n`;

    for (const track of tracks) {
      const duration = Math.round(track.duration || 0);
      const display = track.artist ? `${track.artist} - ${track.title}` : track.title;
      m3u += `#EXTINF:${duration},${display}\n`;
      m3u += `${musicPrefix}${track.filePath}\n`;
    }

    // Write to Playlists/ directory in the MUSIC_PATH (final destination)
    // Also write to LIBRARY_PATH for immediate use before sync
    const targets = [MUSIC_PATH, LIBRARY_PATH].filter(Boolean);
    const safeName = sanitizePathSegment(name);
    let writtenPath = '';

    for (const base of targets) {
      const playlistDir = join(base, 'Playlists');
      await mkdir(playlistDir, { recursive: true });
      const playlistPath = join(playlistDir, `${safeName}.m3u`);

      const resolvedPath = resolve(playlistPath);
      if (!resolvedPath.startsWith(resolve(base))) continue;

      await writeFile(playlistPath, m3u, 'utf-8');
      if (!writtenPath) writtenPath = `Playlists/${safeName}.m3u`;
    }

    jsonResponse(res, 200, { success: true, playlistId: playlist.id, path: writtenPath });
  } catch (err) {
    console.error('[library/playlist] Error:', err.message);
    jsonResponse(res, 500, { error: err.message });
  }
}

/**
 * Parse a JSON body from a request.
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(str));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Static File Serving ──────────────────────────────────────────────────────

async function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;

  // Default to index.html
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = join(STATIC_DIR, urlPath);

  // Prevent path traversal
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(STATIC_DIR))) {
    setCorsHeaders(res);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) throw new Error('Not a file');

    const ext = extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(resolved);

    setCorsHeaders(res);

    // Cache immutable assets (hashed filenames from Vite); never cache the HTML shell
    if (urlPath.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    // SPA fallback: serve index.html for non-file routes
    try {
      const indexPath = join(STATIC_DIR, 'index.html');
      const html = await readFile(indexPath);
      setCorsHeaders(res);
      res.setHeader('Cache-Control', 'no-cache');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      setCorsHeaders(res);
      res.writeHead(404);
      res.end('Not Found');
    }
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // API routes
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return await handleApiConfig(req, res);
    }
    if (url.pathname === '/api/proxy') {
      return handleProxyRoute(req, res, url, jsonResponse);
    }
    if (url.pathname === '/api/library/save' && req.method === 'POST') {
      return await handleLibrarySave(req, res);
    }
    if (url.pathname === '/api/library/check-tracks' && req.method === 'POST') {
      return await handleLibraryCheckTracks(req, res);
    }
    if (url.pathname === '/api/library/playlist' && req.method === 'POST') {
      return await handleLibraryPlaylist(req, res);
    }
    // Library sync routes (/api/library/* except /save and new endpoints)
    if (url.pathname.startsWith('/api/library/') && url.pathname !== '/api/library/save' && url.pathname !== '/api/library/check-tracks' && url.pathname !== '/api/library/playlist') {
      const handled = await handleLibraryRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Download history routes (/api/history*)
    if (url.pathname === '/api/history' || url.pathname.startsWith('/api/history/')) {
      const handled = await handleHistoryRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Playlist routes (/api/playlists*)
    if (url.pathname === '/api/playlists' || url.pathname.startsWith('/api/playlists/')) {
      const handled = await handlePlaylistRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }
    // Server-side download queue routes (/api/downloads*)
    if (url.pathname === '/api/downloads' || url.pathname.startsWith('/api/downloads/')) {
      if (!serverDownloadsEnabled) {
        return jsonResponse(res, 404, { error: 'Server-side downloads are not enabled' });
      }
      const handled = await handleDownloadsRoute(req, res, url, jsonResponse);
      if (handled !== false) return;
    }

    // Static files
    await serveStatic(req, res);
  } catch (err) {
    console.error('[server] Unhandled error:', err);
    setCorsHeaders(res);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function startup() {
  // Initialize database before accepting requests
  try {
    initDb();
  } catch (err) {
    console.error('[saavn-dl] FATAL: Database initialization failed:', err.message);
    process.exit(1);
  }

  // Probe ffmpeg to decide whether server-side downloads can run (Req 1.5, 8.3).
  let ffmpegAvailable = false;
  try {
    ffmpegAvailable = await probeFfmpeg();
  } catch (err) {
    console.warn('[saavn-dl] ffmpeg probe threw:', err.message);
  }
  serverDownloadsEnabled = !!LIBRARY_PATH && ffmpegAvailable;

  server.listen(PORT, () => {
    console.log(`[saavn-dl] Server running on port ${PORT}`);
    console.log(`[saavn-dl] Static dir: ${STATIC_DIR}`);
    console.log(`[saavn-dl] Database: ${DB_PATH}`);

    if (LIBRARY_PATH) {
      console.log(`[saavn-dl] Library path: ${LIBRARY_PATH} (Save to Library enabled)`);
    } else {
      console.log(`[saavn-dl] SAAVN_LIBRARY_PATH not set — Save to Library disabled`);
    }

    // Server-side download queue
    if (serverDownloadsEnabled) {
      console.log(`[saavn-dl] Server-side downloads enabled (ffmpeg available)`);
      downloadWorker.start();
    } else if (!LIBRARY_PATH) {
      console.log(`[saavn-dl] Server-side downloads disabled — SAAVN_LIBRARY_PATH not set`);
    } else {
      console.log(
        `[saavn-dl] Server-side downloads disabled — ffmpeg not available ` +
          `(install ffmpeg-static or set SAAVN_FFMPEG_PATH). Client will use the in-browser pipeline.`,
      );
    }

    if (MUSIC_PATH) {
      console.log(`[saavn-dl] Music path: ${MUSIC_PATH} (Sync to NAS enabled)`);
      initScheduler();
      // Run file path backfill in background (populates file_path for existing tracks)
      backfillFilePaths(MUSIC_PATH).then(result => {
        if (result.matched > 0) {
          console.log(`[saavn-dl] File path backfill: ${result.matched} matched, ${result.unmatched} unmatched of ${result.total} tracks`);
        }
      }).catch(err => {
        console.warn('[saavn-dl] File path backfill failed:', err.message);
      });
    } else {
      console.log(`[saavn-dl] SAAVN_MUSIC_PATH not set — Sync to NAS disabled`);
    }
  });
}

startup();
