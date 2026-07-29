/**
 * SQLite Database Module — schema initialization and connection management.
 *
 * Uses better-sqlite3 for synchronous, fast SQLite access.
 * Database location: SAAVN_DB_PATH env var, defaults to ./data/saavn-dl.db
 *
 * Tables:
 *   - albums          — album-level download history
 *   - tracks          — per-track download history (linked to albums or standalone)
 *   - sync_config     — key/value store for sync configuration
 *   - sync_runs       — history of sync executions
 *   - sync_failed_files — files that failed to sync with retry tracking
 *   - playlists        — user-created playlists
 *   - playlist_tracks  — ordered track membership in playlists
 *   - download_jobs    — persistent server-side download queue
 *   - download_job_tracks — per-track progress for album/playlist jobs
 *   - download_config  — key/value store for queue-level state (paused flag)
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ─── Database path ────────────────────────────────────────────────────────────

function resolveDbPath() {
  const raw = process.env.SAAVN_DB_PATH || './data/saavn-dl.db';
  const resolved = resolve(raw);

  // If path looks like a directory (no file extension), append default filename
  if (!resolved.match(/\.\w+$/)) {
    return resolve(resolved, 'saavn-dl.db');
  }
  return resolved;
}

const DB_PATH = resolveDbPath();

// ─── Initialize ───────────────────────────────────────────────────────────────

let db;

export function getDb() {
  if (db) return db;
  return initDb();
}

export function initDb() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createSchema(db);

  console.log(`[db] SQLite initialized at: ${DB_PATH}`);
  return db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function createSchema(db) {
  db.exec(`
    -- Albums: album-level download records
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      saavn_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      quality TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '',
      song_count INTEGER NOT NULL DEFAULT 0,
      year TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(saavn_id)
    );

    -- Tracks: individual song download records
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      saavn_id TEXT NOT NULL,
      album_id TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      album_title TEXT NOT NULL DEFAULT '',
      album_artist TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      quality TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      play_count INTEGER NOT NULL DEFAULT 0,
      year TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      track_number INTEGER NOT NULL DEFAULT 0,
      file_path TEXT NOT NULL DEFAULT '',
      is_explicit INTEGER NOT NULL DEFAULT 0,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(saavn_id),
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL
    );

    -- Sync config: key/value pairs for sync settings
    CREATE TABLE IF NOT EXISTS sync_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- Sync runs: history of sync executions
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      moved INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      errors TEXT NOT NULL DEFAULT '[]'
    );

    -- Sync failed files: tracks files that failed to sync
    CREATE TABLE IF NOT EXISTS sync_failed_files (
      relative_path TEXT PRIMARY KEY,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      last_attempt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Playlists: user-created playlists (manual or auto-generated)
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      auto_generate INTEGER NOT NULL DEFAULT 0,
      auto_criteria TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name)
    );

    -- Playlist tracks: ordered track membership in playlists
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    -- Download jobs: server-side download queue (persistent, restart-safe)
    CREATE TABLE IF NOT EXISTS download_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,                          -- 'track' | 'album' | 'playlist'
      mode TEXT NOT NULL,                          -- 'library' | 'zip' | 'individual' | 'direct'
      status TEXT NOT NULL DEFAULT 'queued',       -- queued|downloading|done|failed|cancelled
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      quality TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL,                        -- JSON: full song/album detail + overrides
      album_artist_override TEXT,
      is_playlist INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      progress INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'Queued',
      error TEXT NOT NULL DEFAULT '',
      artifact_path TEXT NOT NULL DEFAULT '',       -- browser-delivery: temp file to serve
      artifact_name TEXT NOT NULL DEFAULT '',       -- suggested download filename
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-track progress for album/playlist jobs (drives the expandable UI rows)
    CREATE TABLE IF NOT EXISTS download_job_tracks (
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,                          -- 0-based position within the job
      saavn_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',        -- pending|downloading|done|failed|skipped
      file_path TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (job_id, idx),
      FOREIGN KEY (job_id) REFERENCES download_jobs(id) ON DELETE CASCADE
    );

    -- Small key/value store for queue-level state (e.g. paused flag)
    CREATE TABLE IF NOT EXISTS download_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_download_jobs_status_pos ON download_jobs(status, position);
    CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_saavn_id ON tracks(saavn_id);
    CREATE INDEX IF NOT EXISTS idx_albums_saavn_id ON albums(saavn_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count DESC);
    CREATE INDEX IF NOT EXISTS idx_tracks_downloaded_at ON tracks(downloaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_albums_downloaded_at ON albums(downloaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_timestamp ON sync_runs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
  `);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[db] SQLite connection closed');
  }
}

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
