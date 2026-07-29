/**
 * Download queue store — SQLite persistence for download_jobs / download_job_tracks /
 * download_config.
 *
 * Projects rows into the client-facing QueueState / QueueItem shape (see
 * src/utils/downloadQueue.ts) so the download-manager UI needs minimal change.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

// ─── Config (paused flag etc.) ──────────────────────────────────────────────

export function getConfig(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM download_config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setConfig(key, value) {
  getDb()
    .prepare(
      `INSERT INTO download_config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(value));
}

export function isPaused() {
  return getConfig('paused', '0') === '1';
}

export function setPaused(paused) {
  setConfig('paused', paused ? '1' : '0');
}

// ─── Insert ─────────────────────────────────────────────────────────────────

function nextPosition(db) {
  const row = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM download_jobs').get();
  return row.pos;
}

/**
 * Insert a track job.
 * @param {object} args { song, quality, mode, overrideMeta?, overrideFilename? }
 * @returns {string} job id
 */
export function insertTrackJob({ song, quality, mode = 'direct', overrideMeta, overrideFilename }) {
  const db = getDb();
  const id = `track-${song.id}-${Date.now()}`;
  const artist =
    song.subtitle?.split(' - ')[0]?.trim() ||
    song.more_info?.artists?.primary?.[0]?.name ||
    'Unknown Artist';

  const payload = JSON.stringify({ song, quality, mode, overrideMeta, overrideFilename });

  db.prepare(
    `INSERT INTO download_jobs
       (id, type, mode, status, title, artist, image, quality, payload, is_playlist, position, stage)
     VALUES (?, 'track', ?, 'queued', ?, ?, ?, ?, ?, 0, ?, 'Queued')`,
  ).run(id, mode, song.title || '', artist, song.image || '', String(quality), payload, nextPosition(db));

  return id;
}

/**
 * Insert an album/playlist job.
 * @param {object} args { album, quality, mode, albumArtistOverride?, isPlaylist? }
 * @returns {string} job id
 */
export function insertAlbumJob({ album, quality, mode = 'library', albumArtistOverride, isPlaylist = false }) {
  const db = getDb();
  const id = `album-${album.id}-${Date.now()}`;
  const artist =
    album.artists?.primary?.map((a) => a.name).join(', ') || album.subtitle || 'Unknown Artist';

  const payload = JSON.stringify({ album, quality, mode, albumArtistOverride, isPlaylist });
  const type = isPlaylist ? 'playlist' : 'album';

  db.prepare(
    `INSERT INTO download_jobs
       (id, type, mode, status, title, artist, image, quality, payload, album_artist_override, is_playlist, position, stage)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, 'Queued')`,
  ).run(
    id,
    type,
    mode,
    album.title || '',
    artist,
    album.image || '',
    String(quality),
    payload,
    albumArtistOverride || null,
    isPlaylist ? 1 : 0,
    nextPosition(db),
  );

  // Seed per-track rows immediately so the client can render the tracklist and
  // per-track progress from the moment the job is queued.
  const songs = Array.isArray(album.songs) ? album.songs : [];
  if (songs.length > 0) {
    initJobTracks(id, songs.map((s) => ({ saavnId: s.id, title: s.title })));
  }

  return id;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export function getJobRow(id) {
  return getDb().prepare('SELECT * FROM download_jobs WHERE id = ?').get(id);
}

/** Parsed payload for a job (or null). */
export function getJobPayload(id) {
  const row = getJobRow(id);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

/** Lowest-position queued job, or null. */
export function nextQueued() {
  return getDb()
    .prepare(`SELECT * FROM download_jobs WHERE status = 'queued' ORDER BY position ASC LIMIT 1`)
    .get();
}

export function hasActiveJob() {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM download_jobs WHERE status = 'downloading'`)
    .get();
  return row.c > 0;
}

function getJobTracks(jobId) {
  return getDb()
    .prepare('SELECT * FROM download_job_tracks WHERE job_id = ? ORDER BY idx ASC')
    .all(jobId);
}

// ─── Updates ────────────────────────────────────────────────────────────────

export function updateStatus(id, status, extra = {}) {
  const db = getDb();
  const fields = ['status = ?', "updated_at = datetime('now')"];
  const params = [status];
  if ('error' in extra) { fields.push('error = ?'); params.push(extra.error || ''); }
  if ('stage' in extra) { fields.push('stage = ?'); params.push(extra.stage || ''); }
  if ('progress' in extra) { fields.push('progress = ?'); params.push(Math.round(extra.progress) || 0); }
  if ('artifactPath' in extra) { fields.push('artifact_path = ?'); params.push(extra.artifactPath || ''); }
  if ('artifactName' in extra) { fields.push('artifact_name = ?'); params.push(extra.artifactName || ''); }
  params.push(id);
  db.prepare(`UPDATE download_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function updateProgress(id, progress, stage) {
  getDb()
    .prepare(`UPDATE download_jobs SET progress = ?, stage = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(Math.round(progress) || 0, stage || '', id);
}

/** Reset all jobs stuck in 'downloading' back to 'queued' (restart recovery). */
export function resetDownloadingToQueued() {
  const info = getDb()
    .prepare(`UPDATE download_jobs SET status = 'queued', progress = 0, stage = 'Queued', updated_at = datetime('now') WHERE status = 'downloading'`)
    .run();
  // Also reset any half-finished per-track rows.
  getDb()
    .prepare(`UPDATE download_job_tracks SET status = 'pending' WHERE status = 'downloading'`)
    .run();
  return info.changes;
}

// ─── Per-track rows ─────────────────────────────────────────────────────────

/** Seed per-track rows for an album/playlist job. tracks: [{ saavnId, title }] */
export function initJobTracks(jobId, tracks) {
  const db = getDb();
  const del = db.prepare('DELETE FROM download_job_tracks WHERE job_id = ?');
  const ins = db.prepare(
    `INSERT INTO download_job_tracks (job_id, idx, saavn_id, title, status) VALUES (?, ?, ?, ?, 'pending')`,
  );
  db.transaction(() => {
    del.run(jobId);
    tracks.forEach((t, i) => ins.run(jobId, i, t.saavnId || '', t.title || ''));
  })();
}

export function updateJobTrack(jobId, idx, { status, filePath, error } = {}) {
  const db = getDb();
  const fields = [];
  const params = [];
  if (status !== undefined) { fields.push('status = ?'); params.push(status); }
  if (filePath !== undefined) { fields.push('file_path = ?'); params.push(filePath || ''); }
  if (error !== undefined) { fields.push('error = ?'); params.push(error || ''); }
  if (fields.length === 0) return;
  params.push(jobId, idx);
  db.prepare(`UPDATE download_job_tracks SET ${fields.join(', ')} WHERE job_id = ? AND idx = ?`).run(...params);
}

// ─── Reorder / remove / clear ───────────────────────────────────────────────

/** Move a queued job up or down among the queued jobs. */
export function moveJob(id, dir) {
  const db = getDb();
  const job = db.prepare('SELECT id, status, position FROM download_jobs WHERE id = ?').get(id);
  if (!job || job.status !== 'queued') return false;

  const neighbor =
    dir === 'up'
      ? db.prepare(`SELECT id, position FROM download_jobs WHERE status = 'queued' AND position < ? ORDER BY position DESC LIMIT 1`).get(job.position)
      : db.prepare(`SELECT id, position FROM download_jobs WHERE status = 'queued' AND position > ? ORDER BY position ASC LIMIT 1`).get(job.position);

  if (!neighbor) return false;

  db.transaction(() => {
    db.prepare('UPDATE download_jobs SET position = ? WHERE id = ?').run(neighbor.position, job.id);
    db.prepare('UPDATE download_jobs SET position = ? WHERE id = ?').run(job.position, neighbor.id);
  })();
  return true;
}

export function removeJob(id) {
  getDb().prepare('DELETE FROM download_jobs WHERE id = ?').run(id);
}

export function clearCompleted() {
  getDb()
    .prepare(`DELETE FROM download_jobs WHERE status IN ('done', 'failed', 'cancelled')`)
    .run();
}

/** Reset a failed/cancelled job back to queued (retry). Returns true if it changed. */
export function requeueJob(id) {
  const db = getDb();
  const job = db.prepare('SELECT status FROM download_jobs WHERE id = ?').get(id);
  if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return false;
  db.transaction(() => {
    db.prepare(
      `UPDATE download_jobs SET status = 'queued', progress = 0, stage = 'Queued (retry)', error = '', position = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(nextPosition(db), id);
    db.prepare(`UPDATE download_job_tracks SET status = 'pending', error = '' WHERE job_id = ? AND status IN ('failed', 'downloading')`).run(id);
  })();
  return true;
}

// ─── Projection to client QueueState ────────────────────────────────────────

function projectTrackStatuses(trackRows) {
  return trackRows.map((t) => ({
    id: t.saavn_id || String(t.idx),
    title: t.title,
    status: t.status,
    error: t.error || undefined,
    filePath: t.file_path || undefined,
  }));
}

function projectJob(row) {
  const base = {
    id: row.id,
    type: row.type === 'track' ? 'track' : 'album',
    title: row.title,
    artist: row.artist,
    image: row.image,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    error: row.error || undefined,
    addedAt: Date.parse(row.created_at) || Date.now(),
    quality: row.quality,
    mode: row.mode,
  };

  if (row.type === 'track') {
    return {
      ...base,
      artifactName: row.artifact_name || undefined,
      hasArtifact: !!row.artifact_path,
    };
  }

  // album / playlist
  const trackRows = getJobTracks(row.id);
  const tracks = projectTrackStatuses(trackRows);
  const total = tracks.length;
  const startedCount = trackRows.filter((t) => t.status !== 'pending').length;
  const downloadingIdx = trackRows.findIndex((t) => t.status === 'downloading');
  const current = downloadingIdx >= 0 ? downloadingIdx + 1 : Math.min(startedCount, total);
  const currentTitle =
    downloadingIdx >= 0 ? trackRows[downloadingIdx].title : trackRows[Math.max(0, current - 1)]?.title || '';

  return {
    ...base,
    isPlaylist: !!row.is_playlist,
    albumArtistOverride: row.album_artist_override || undefined,
    artifactName: row.artifact_name || undefined,
    hasArtifact: !!row.artifact_path,
    trackProgress: total
      ? {
          current,
          total,
          currentTitle,
          stage: row.stage,
          percent: row.progress,
          tracks,
        }
      : undefined,
  };
}

/** Full client-facing queue state. */
export function getState() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM download_jobs ORDER BY position ASC').all();
  return {
    items: rows.map(projectJob),
    isProcessing: rows.some((r) => r.status === 'downloading'),
    isPaused: isPaused(),
  };
}
