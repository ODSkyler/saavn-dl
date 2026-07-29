/**
 * History recording bridge for server-side jobs.
 *
 * Thin, best-effort wrappers over server/history/store.js so a history write can never
 * fail a download job. The field mapping mirrors what the client records today (see
 * src/utils/history.ts usage in albumDownload.ts / downloadQueue.ts) so existing history
 * views and "already downloaded" badges keep working.
 */

import { addEntry } from '../history/store.js';

/** Record a standalone track (mirrors client recordDownload({ type: 'track', ... })). */
export function recordTrack(entry) {
  try {
    addEntry({ type: 'track', ...entry });
  } catch (err) {
    console.warn('[downloads/recorder] track history write failed:', err.message);
  }
}

/**
 * Record an album/playlist-level entry with per-track rows
 * (mirrors client downloadQueue.recordToHistory album branch).
 */
export function recordAlbum(entry) {
  try {
    addEntry({ type: 'album', ...entry });
  } catch (err) {
    console.warn('[downloads/recorder] album history write failed:', err.message);
  }
}
