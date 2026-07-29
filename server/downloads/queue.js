/**
 * Persistent download queue + worker (singleton per server process).
 *
 * The worker processes jobs sequentially (one active job at a time), independently of any
 * browser tab. Jobs and their progress are persisted in SQLite (see store.js) so they
 * survive tab closure and server restarts: on start(), any job left in 'downloading' is
 * reset to 'queued' and retried.
 *
 * Cancellation aborts in-flight fetch + ffmpeg work via an AbortController. Pause/resume
 * is persisted so it survives restarts. Progress broadcasts are throttled (~500ms / on
 * stage change) to avoid excessive work; status transitions always persist + broadcast.
 */

import * as store from './store.js';
import { broadcast } from './events.js';
import { recordTrack, recordAlbum } from './recorder.js';
import { processTrack, writeToLibrary, getArtistTag, isLibraryConfigured } from './engine.js';
import { cleanupJobTempDir } from './ffmpeg.js';
import { writeArtifact, deleteArtifact } from './artifacts.js';
import { sanitizeFilename } from './decrypt.js';
import {
  processAlbumLibrary,
  processPlaylistLibrary,
  processAlbumArchive,
  detectMultiArtist,
  getArtistName,
} from './album.js';

const PROGRESS_EMIT_INTERVAL_MS = 500;

class DownloadWorker {
  constructor() {
    this.activeJobId = null;
    this.activeController = null;
    this.pendingRemoval = new Set();
    this.started = false;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this.started) return;
    this.started = true;
    const reset = store.resetDownloadingToQueued();
    if (reset > 0) console.log(`[downloads/queue] restart recovery: reset ${reset} interrupted job(s) to queued`);
    this.emit();
    this.tick();
  }

  emit() {
    try {
      broadcast(store.getState());
    } catch (err) {
      console.warn('[downloads/queue] broadcast failed:', err.message);
    }
  }

  getState() {
    return store.getState();
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  tick() {
    if (this.activeJobId) return;
    if (store.isPaused()) return;
    const next = store.nextQueued();
    if (!next) return;
    // Fire and forget; process() re-ticks in its finally.
    this.process(next).catch((err) => {
      console.error('[downloads/queue] unexpected worker error:', err);
    });
  }

  async process(job) {
    this.activeJobId = job.id;
    this.activeController = new AbortController();
    const signal = this.activeController.signal;

    store.updateStatus(job.id, 'downloading', { stage: 'Starting…', progress: 0 });
    this.emit();

    const ctx = this.makeCtx(job);

    try {
      let payload = store.getJobPayload(job.id);
      if (!payload) throw new Error('Job payload missing or invalid');

      if (job.type === 'track') {
        await this.processTrackJob(job, payload, ctx, signal);
      } else {
        await this.processAlbumJob(job, payload, ctx, signal);
      }

      if (signal.aborted) {
        store.updateStatus(job.id, 'cancelled', { stage: 'Cancelled' });
      } else {
        store.updateStatus(job.id, 'done', { stage: 'Done!', progress: 100 });
      }
    } catch (err) {
      if (signal.aborted) {
        store.updateStatus(job.id, 'cancelled', { stage: 'Cancelled' });
      } else {
        const msg = err instanceof Error ? err.message : 'Download failed';
        console.error(`[downloads/queue] job ${job.id} failed:`, msg);
        store.updateStatus(job.id, 'failed', { stage: 'Failed', error: msg });
      }
    } finally {
      await cleanupJobTempDir(job.id);
      if (this.pendingRemoval.has(job.id)) {
        this.pendingRemoval.delete(job.id);
        this.deleteJobArtifact(job.id);
        store.removeJob(job.id);
      }
      this.activeJobId = null;
      this.activeController = null;
      this.emit();
      if (!store.isPaused()) this.tick();
    }
  }

  /** Best-effort delete of a job's browser-delivery artifact file. */
  deleteJobArtifact(id) {
    const row = store.getJobRow(id);
    if (row && row.artifact_path) void deleteArtifact(row.artifact_path);
  }

  /** Per-job progress/track hooks with throttled broadcasting. */
  makeCtx(job) {
    let lastStage = '';
    let lastTs = 0;
    const setProgress = (pct, stage) => {
      const now = Date.now();
      const stageChanged = stage !== lastStage;
      if (stageChanged || now - lastTs >= PROGRESS_EMIT_INTERVAL_MS || pct >= 100) {
        store.updateProgress(job.id, pct, stage);
        lastStage = stage;
        lastTs = now;
        this.emit();
      }
    };
    const setTrack = (idx, patch) => {
      store.updateJobTrack(job.id, idx, patch);
      this.emit();
    };
    return { jobId: job.id, signal: this.activeController.signal, setProgress, setTrack };
  }

  // ── Track job (library mode) ──────────────────────────────────────────────

  async processTrackJob(job, payload, ctx, signal) {
    const { song, quality, mode, overrideMeta, overrideFilename } = payload;

    const buffer = await processTrack(song, quality, {
      jobId: job.id,
      signal,
      overrideMeta,
      publisher: song.more_info?.label,
      copyright: song.more_info?.copyright_text,
      onProgress: (stage, p) => ctx.setProgress(p, stage),
    });

    const artistName = overrideMeta?.artist || getArtistTag(song);
    const baseName = overrideFilename || `${overrideMeta?.title || song.title} - ${artistName}`;
    const filename = `${sanitizeFilename(baseName)}.m4a`;

    if (mode === 'library') {
      if (!isLibraryConfigured()) throw new Error('Library saving is not configured');
      const albumName = overrideMeta?.album || song.more_info?.album || 'Unknown Album';
      const year = overrideMeta?.year || song.year || '';
      const albumFolder = `${sanitizeFilename(albumName)}${year ? ` (${year})` : ''}`;

      ctx.setProgress(96, 'Saving to library…');
      const savedPath = await writeToLibrary(buffer, artistName, albumFolder, filename);

      recordTrack({
        saavnId: song.id,
        title: overrideMeta?.title || song.title,
        artist: artistName,
        album: albumName,
        image: song.image || '',
        quality,
        mode: 'library',
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year,
        language: song.language || '',
        isExplicit: song.isExplicit || false,
        filePath: savedPath,
      });
    } else {
      // Browser-delivery (direct): store an artifact for the browser to fetch.
      ctx.setProgress(96, 'Finalizing…');
      const abs = await writeArtifact(job.id, filename, buffer);
      store.setArtifact(job.id, abs, filename);

      recordTrack({
        saavnId: song.id,
        title: overrideMeta?.title || song.title,
        artist: artistName,
        album: overrideMeta?.album || song.more_info?.album || '',
        image: song.image || '',
        quality,
        mode,
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year: overrideMeta?.year || song.year || '',
        language: song.language || '',
        isExplicit: song.isExplicit || false,
      });
    }
  }

  // ── Album / playlist job (library mode) ───────────────────────────────────

  async processAlbumJob(job, payload, ctx, signal) {
    const { album, quality, mode, albumArtistOverride, isPlaylist } = payload;

    const songs = album.songs || [];
    // Per-track rows were seeded at enqueue time (store.insertAlbumJob). On retry/restart
    // the store resets non-done rows, so we don't reseed here (which would wipe progress).
    this.emit();

    if (mode === 'library') {
      if (!isLibraryConfigured()) throw new Error('Library saving is not configured');

      let results;
      if (isPlaylist) {
        results = await processPlaylistLibrary(album, quality, ctx);
      } else {
        // Navidrome fix: auto-detect multi-artist albums when no explicit override.
        let embedAlbumArtist = albumArtistOverride;
        if (!embedAlbumArtist) {
          const info = detectMultiArtist(album);
          if (info.isMultiArtist) embedAlbumArtist = info.suggestedAlbumArtist;
        }
        results = await processAlbumLibrary(album, quality, { ...ctx, albumArtistOverride: embedAlbumArtist });
      }

      if (signal.aborted) return;
      this.recordAlbumHistory(job, payload, results);
    } else {
      // Browser-delivery (zip / individual): produce a single ZIP artifact (Req 7.5).
      let embedAlbumArtist = albumArtistOverride;
      if (!embedAlbumArtist) {
        const info = detectMultiArtist(album);
        if (info.isMultiArtist) embedAlbumArtist = info.suggestedAlbumArtist;
      }
      const { buffer, filename, results } = await processAlbumArchive(album, quality, {
        ...ctx,
        albumArtistOverride: embedAlbumArtist,
      });

      if (signal.aborted) return;
      const abs = await writeArtifact(job.id, filename, buffer);
      store.setArtifact(job.id, abs, filename);
      this.recordAlbumHistory(job, payload, results);
    }
  }

  /** Album/playlist-level history record (mirrors downloadQueue.recordToHistory). */
  recordAlbumHistory(job, payload, results) {
    const { album, quality, mode, albumArtistOverride, isPlaylist } = payload;
    const songs = album.songs || [];
    const byId = new Map(results.map((r) => [r.song.id, r]));

    const tracks = songs.map((song, idx) => {
      const r = byId.get(song.id);
      const artistName = getArtistName(song);
      return {
        saavnId: song.id,
        title: song.title,
        artist: artistName,
        albumTitle: isPlaylist ? song.more_info?.album || album.title : album.title,
        albumArtist: isPlaylist ? artistName : albumArtistOverride || job.artist,
        duration: song.more_info?.duration || '0',
        playCount: song.play_count || '0',
        year: song.year || album.year || '',
        language: song.language || album.language || '',
        trackNumber: idx + 1,
        isExplicit: song.isExplicit || false,
        image: song.image || album.image || '',
        filePath: r?.filePath || '',
        skipIfExists: isPlaylist || false,
      };
    });

    recordAlbum({
      saavnId: album.id,
      title: album.title,
      artist: job.artist,
      album: album.title,
      image: album.image || '',
      quality,
      mode,
      songCount: songs.length,
      year: album.year || '',
      language: album.language || '',
      tracks,
    });
  }

  // ── Public queue controls ─────────────────────────────────────────────────

  enqueueTrack(args) {
    const id = store.insertTrackJob(args);
    this.emit();
    this.tick();
    return id;
  }

  enqueueAlbum(args) {
    const id = store.insertAlbumJob(args);
    this.emit();
    this.tick();
    return id;
  }

  cancel(id) {
    if (id === this.activeJobId && this.activeController) {
      this.activeController.abort();
      return true;
    }
    const row = store.getJobRow(id);
    if (row && row.status === 'queued') {
      store.updateStatus(id, 'cancelled', { stage: 'Cancelled' });
      this.emit();
      return true;
    }
    return false;
  }

  retry(id) {
    const ok = store.requeueJob(id);
    if (ok) {
      this.emit();
      this.tick();
    }
    return ok;
  }

  move(id, dir) {
    const ok = store.moveJob(id, dir === 'down' ? 'down' : 'up');
    if (ok) this.emit();
    return ok;
  }

  remove(id) {
    if (id === this.activeJobId && this.activeController) {
      this.pendingRemoval.add(id);
      this.activeController.abort();
      return true;
    }
    this.deleteJobArtifact(id);
    store.removeJob(id);
    this.emit();
    return true;
  }

  clearCompleted() {
    for (const p of store.getArtifactPathsForStatuses(['done', 'failed', 'cancelled'])) {
      void deleteArtifact(p);
    }
    store.clearCompleted();
    this.emit();
  }

  clearAll() {
    if (this.activeJobId && this.activeController) this.activeController.abort();
    // Remove everything except the active job (which is settling); it will be cleared
    // on its terminal transition sweep or a subsequent clearCompleted.
    const state = store.getState();
    for (const item of state.items) {
      if (item.id !== this.activeJobId) {
        this.deleteJobArtifact(item.id);
        store.removeJob(item.id);
      }
    }
    this.emit();
  }

  pause() {
    store.setPaused(true);
    this.emit();
  }

  resume() {
    store.setPaused(false);
    this.emit();
    this.tick();
  }
}

export const downloadWorker = new DownloadWorker();
