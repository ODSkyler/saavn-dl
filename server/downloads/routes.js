/**
 * HTTP route handler for /api/downloads/* — the server-side download queue API.
 *
 * Mirrors the library/history route module pattern: returns true when a request was
 * handled, false otherwise. Payloads are validated and size-capped.
 *
 * Endpoints:
 *   GET    /api/downloads               → current QueueState
 *   POST   /api/downloads/track         → enqueue a track job
 *   POST   /api/downloads/album         → enqueue an album/playlist job
 *   POST   /api/downloads/:id/cancel    → cancel a job (aborts if active)
 *   POST   /api/downloads/:id/retry     → requeue a failed/cancelled job
 *   POST   /api/downloads/:id/move      → { dir: 'up'|'down' } reorder a queued job
 *   DELETE /api/downloads/:id           → remove a job (cancels if active)
 *   POST   /api/downloads/clear-completed
 *   POST   /api/downloads/pause | /resume
 *   GET    /api/downloads/events        → SSE stream of QueueState snapshots
 */

import { downloadWorker } from './queue.js';
import { addSseClient } from './events.js';

const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB — large playlists carry full song detail
const VALID_QUALITIES = new Set(['12', '48', '96', '160', '320']);
const VALID_MODES = new Set(['library', 'zip', 'individual', 'direct']);

// ─── Body parsing ────────────────────────────────────────────────────────────

function parseJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const str = Buffer.concat(chunks).toString('utf-8');
        resolvePromise(str ? JSON.parse(str) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateSong(song) {
  return (
    song &&
    typeof song === 'object' &&
    typeof song.id === 'string' &&
    song.more_info &&
    typeof song.more_info.encrypted_media_url === 'string' &&
    song.more_info.encrypted_media_url.length > 0
  );
}

function validateAlbum(album) {
  return (
    album &&
    typeof album === 'object' &&
    typeof album.id === 'string' &&
    Array.isArray(album.songs) &&
    album.songs.length > 0 &&
    album.songs.every(validateSong)
  );
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handles /api/downloads/* requests.
 * Returns true if handled, false otherwise.
 */
export async function handleDownloadsRoute(req, res, url, jsonResponse) {
  const { pathname } = url;
  const rest = pathname.slice('/api/downloads'.length); // '' | '/track' | '/:id' | '/:id/action'

  // GET /api/downloads → current state
  if (pathname === '/api/downloads' && req.method === 'GET') {
    return jsonResponse(res, 200, downloadWorker.getState());
  }

  // GET /api/downloads/events → SSE
  if (rest === '/events' && req.method === 'GET') {
    addSseClient(req, res, downloadWorker.getState());
    return true;
  }

  // POST /api/downloads/track
  if (rest === '/track' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { song, quality, mode = 'library', overrideMeta, overrideFilename } = body || {};
      if (!validateSong(song)) return jsonResponse(res, 400, { error: 'Invalid or missing song' });
      if (!VALID_QUALITIES.has(String(quality))) return jsonResponse(res, 400, { error: 'Invalid quality' });
      if (!VALID_MODES.has(mode)) return jsonResponse(res, 400, { error: 'Invalid mode' });
      const id = downloadWorker.enqueueTrack({ song, quality: String(quality), mode, overrideMeta, overrideFilename });
      return jsonResponse(res, 200, { enqueuedId: id, ...downloadWorker.getState() });
    } catch (err) {
      return jsonResponse(res, 400, { error: err.message });
    }
  }

  // POST /api/downloads/album
  if (rest === '/album' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { album, quality, mode = 'library', albumArtistOverride, isPlaylist = false } = body || {};
      if (!validateAlbum(album)) return jsonResponse(res, 400, { error: 'Invalid or missing album' });
      if (!VALID_QUALITIES.has(String(quality))) return jsonResponse(res, 400, { error: 'Invalid quality' });
      if (!VALID_MODES.has(mode)) return jsonResponse(res, 400, { error: 'Invalid mode' });
      const id = downloadWorker.enqueueAlbum({
        album,
        quality: String(quality),
        mode,
        albumArtistOverride: albumArtistOverride || undefined,
        isPlaylist: !!isPlaylist,
      });
      return jsonResponse(res, 200, { enqueuedId: id, ...downloadWorker.getState() });
    } catch (err) {
      return jsonResponse(res, 400, { error: err.message });
    }
  }

  // POST /api/downloads/clear-completed
  if (rest === '/clear-completed' && req.method === 'POST') {
    downloadWorker.clearCompleted();
    return jsonResponse(res, 200, downloadWorker.getState());
  }

  // POST /api/downloads/clear-all
  if (rest === '/clear-all' && req.method === 'POST') {
    downloadWorker.clearAll();
    return jsonResponse(res, 200, downloadWorker.getState());
  }

  // POST /api/downloads/pause | /resume
  if (rest === '/pause' && req.method === 'POST') {
    downloadWorker.pause();
    return jsonResponse(res, 200, downloadWorker.getState());
  }
  if (rest === '/resume' && req.method === 'POST') {
    downloadWorker.resume();
    return jsonResponse(res, 200, downloadWorker.getState());
  }

  // /:id and /:id/action
  const parts = rest.split('/').filter(Boolean);

  // DELETE /api/downloads/:id
  if (parts.length === 1 && req.method === 'DELETE') {
    const id = decodeURIComponent(parts[0]);
    downloadWorker.remove(id);
    return jsonResponse(res, 200, downloadWorker.getState());
  }

  // POST /api/downloads/:id/<action>
  if (parts.length === 2 && req.method === 'POST') {
    const id = decodeURIComponent(parts[0]);
    const action = parts[1];

    if (action === 'cancel') {
      downloadWorker.cancel(id);
      return jsonResponse(res, 200, downloadWorker.getState());
    }
    if (action === 'retry') {
      downloadWorker.retry(id);
      return jsonResponse(res, 200, downloadWorker.getState());
    }
    if (action === 'move') {
      try {
        const body = await parseJsonBody(req);
        const dir = body?.dir === 'down' ? 'down' : 'up';
        downloadWorker.move(id, dir);
        return jsonResponse(res, 200, downloadWorker.getState());
      } catch (err) {
        return jsonResponse(res, 400, { error: err.message });
      }
    }
  }

  // Not handled by this module.
  return false;
}
