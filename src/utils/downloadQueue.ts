import type { SaavnSong, AlbumDetail, Quality } from '../types/saavn';
import type { TrackMetadata } from '../types/metadata';
import { downloadWithMetadata } from './download';
import { downloadAlbumIndividual, downloadAlbumZip, downloadAlbumLibrary, downloadPlaylistLibrary, detectMultiArtist } from './albumDownload';
import type { AlbumDownloadMode, AlbumDownloadProgress } from './albumDownload';
import { recordDownload } from './history';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemType = 'track' | 'album';
export type QueueItemStatus = 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled';

export interface QueueTrackItem {
  id: string;
  type: 'track';
  title: string;
  artist: string;
  image: string;
  status: QueueItemStatus;
  progress: number;
  stage: string;
  error?: string;
  addedAt: number;
  song: SaavnSong;
  quality: Quality;
  overrideMeta?: TrackMetadata;
  overrideFilename?: string;
  /** Server-delivery (Phase 2): artifact awaiting browser pickup. */
  hasArtifact?: boolean;
  artifactName?: string;
}

export interface QueueAlbumItem {
  id: string;
  type: 'album';
  title: string;
  artist: string;
  image: string;
  status: QueueItemStatus;
  progress: number;
  stage: string;
  error?: string;
  addedAt: number;
  album: AlbumDetail;
  quality: Quality;
  mode: AlbumDownloadMode;
  albumArtistOverride?: string;
  isPlaylist?: boolean;
  trackProgress?: AlbumDownloadProgress;
  /** Server-delivery (Phase 2): artifact awaiting browser pickup. */
  hasArtifact?: boolean;
  artifactName?: string;
}

export type QueueItem = QueueTrackItem | QueueAlbumItem;

export interface QueueState {
  items: QueueItem[];
  isProcessing: boolean;
  isPaused: boolean;
}

export type QueueListener = (state: QueueState) => void;

/**
 * Shared backend contract. The in-memory backend (browser pipeline, used for static
 * deployments and browser-delivery jobs) and the server backend (persistent server-side
 * queue) both implement this, and the exported `downloadQueue` router delegates to them.
 */
export interface QueueBackend {
  subscribe(listener: QueueListener): () => void;
  getState(): QueueState;
  addTrack(song: SaavnSong, quality: Quality, overrideMeta?: TrackMetadata, overrideFilename?: string): void;
  addAlbum(album: AlbumDetail, quality: Quality, mode: AlbumDownloadMode, albumArtistOverride?: string, isPlaylist?: boolean): void;
  removeItem(id: string): void;
  retryItem(id: string): void;
  cancelCurrent(): void;
  clearCompleted(): void;
  clearAll(): void;
  pause(): void;
  resume(): void;
  moveUp(id: string): void;
  moveDown(id: string): void;
}

// ─── In-memory backend (browser pipeline — unchanged behavior) ─────────────────

class InMemoryBackend implements QueueBackend {
  private items: QueueItem[] = [];
  private isProcessing = false;
  private isPaused = false;
  private listeners: Set<QueueListener> = new Set();
  private abortController: AbortController | null = null;
  private cancelled = false;

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): QueueState {
    return { items: [...this.items], isProcessing: this.isProcessing, isPaused: this.isPaused };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  // ── Add items ─────────────────────────────────────────────────────────────

  addTrack(
    song: SaavnSong,
    quality: Quality,
    overrideMeta?: TrackMetadata,
    overrideFilename?: string,
  ): void {
    const artist =
      song.subtitle?.split(' - ')[0]?.trim() ||
      song.more_info.artists?.primary?.[0]?.name ||
      'Unknown Artist';

    const item: QueueTrackItem = {
      id: `track-${song.id}-${Date.now()}`,
      type: 'track',
      title: song.title,
      artist,
      image: song.image,
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      addedAt: Date.now(),
      song,
      quality,
      overrideMeta,
      overrideFilename,
    };

    this.items.push(item);
    this.emit();
    this.processNext();
  }

  addAlbum(
    album: AlbumDetail,
    quality: Quality,
    mode: AlbumDownloadMode,
    albumArtistOverride?: string,
    isPlaylist?: boolean,
  ): void {
    const artist =
      album.artists?.primary?.map((a) => a.name).join(', ') || album.subtitle || 'Unknown Artist';

    const item: QueueAlbumItem = {
      id: `album-${album.id}-${Date.now()}`,
      type: 'album',
      title: album.title,
      artist,
      image: album.image,
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      addedAt: Date.now(),
      album,
      quality,
      mode,
      albumArtistOverride,
      isPlaylist,
    };

    this.items.push(item);
    this.emit();
    this.processNext();
  }

  // ── Remove / Cancel ───────────────────────────────────────────────────────

  removeItem(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const item = this.items[idx];
    if (item.status === 'downloading') {
      // Cancel active download
      this.cancelCurrent();
    } else {
      this.items.splice(idx, 1);
    }
    this.emit();
  }

  cancelCurrent(): void {
    if (!this.isProcessing) return;
    this.cancelled = true;
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // ── Retry ─────────────────────────────────────────────────────────────────

  retryItem(id: string): void {
    const item = this.items.find((i) => i.id === id);
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return;
    item.status = 'queued';
    item.progress = 0;
    item.stage = 'Queued (retry)';
    item.error = undefined;
    this.emit();
    this.processNext();
  }

  // ── Clear ─────────────────────────────────────────────────────────────────

  clearCompleted(): void {
    this.items = this.items.filter((i) => i.status !== 'done' && i.status !== 'failed' && i.status !== 'cancelled');
    this.emit();
  }

  clearAll(): void {
    // Cancel active download if any
    if (this.isProcessing) {
      this.cancelCurrent();
    }
    // Remove all non-active items
    this.items = this.items.filter((i) => i.status === 'downloading');
    this.emit();
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  pause(): void {
    this.isPaused = true;
    this.emit();
  }

  resume(): void {
    this.isPaused = false;
    this.emit();
    this.processNext();
  }

  // ── Reorder ───────────────────────────────────────────────────────────────

  moveUp(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx <= 0) return;
    const item = this.items[idx];
    if (item.status !== 'queued') return;
    // Find the previous queued item to swap with
    let prevIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (this.items[i].status === 'queued') { prevIdx = i; break; }
    }
    if (prevIdx === -1) return;
    [this.items[prevIdx], this.items[idx]] = [this.items[idx], this.items[prevIdx]];
    this.emit();
  }

  moveDown(id: string): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1 || idx >= this.items.length - 1) return;
    const item = this.items[idx];
    if (item.status !== 'queued') return;
    // Find the next queued item to swap with
    const nextIdx = this.items.slice(idx + 1).findIndex((i) => i.status === 'queued');
    if (nextIdx === -1) return;
    const actualNextIdx = idx + 1 + nextIdx;
    [this.items[idx], this.items[actualNextIdx]] = [this.items[actualNextIdx], this.items[idx]];
    this.emit();
  }

  // ── Processing ────────────────────────────────────────────────────────────

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.isPaused) return;

    const next = this.items.find((i) => i.status === 'queued');
    if (!next) return;

    this.isProcessing = true;
    this.cancelled = false;
    this.abortController = new AbortController();
    next.status = 'downloading';
    next.stage = 'Starting…';
    this.emit();

    try {
      if (next.type === 'track') {
        await this.processTrack(next);
      } else {
        await this.processAlbum(next);
      }

      if (this.cancelled) {
        next.status = 'cancelled';
        next.stage = 'Cancelled';
      } else {
        next.status = 'done';
        next.progress = 100;
        next.stage = 'Done!';

        // Record to download history
        this.recordToHistory(next).catch(() => { /* best-effort */ });
      }
    } catch (err) {
      if (this.cancelled) {
        next.status = 'cancelled';
        next.stage = 'Cancelled';
      } else {
        next.status = 'failed';
        next.error = err instanceof Error ? err.message : 'Download failed';
        next.stage = 'Failed';
      }
    }

    this.isProcessing = false;
    this.abortController = null;
    this.emit();

    // Process next in queue
    if (!this.isPaused) {
      this.processNext();
    }
  }

  private async processTrack(item: QueueTrackItem): Promise<void> {
    await downloadWithMetadata({
      song: item.song,
      quality: item.quality,
      onProgress: (stage, percent) => {
        if (this.cancelled) return;
        item.stage = stage;
        item.progress = percent;
        this.emit();
      },
      overrideMeta: item.overrideMeta,
      overrideFilename: item.overrideFilename,
    });
  }

  private async processAlbum(item: QueueAlbumItem): Promise<void> {
    const onProgress = (p: AlbumDownloadProgress) => {
      if (this.cancelled) return;
      item.trackProgress = p;
      item.progress = p.percent;
      item.stage = p.zipStage
        ? p.zipStage === 'compressing'
          ? 'Creating ZIP…'
          : p.zipStage === 'preparing'
            ? 'Preparing…'
            : 'Done'
        : `Track ${p.current}/${p.total}: ${p.stage}`;
      this.emit();
    };

    // Auto-skip failures in background mode (no interactive prompt)
    const onFailure = async (): Promise<'skip' | 'retry'> => 'retry';

    // For playlists in library mode, use the playlist-specific downloader
    // that uses per-track Artist/Album structure, skips existing tracks,
    // and generates an m3u playlist file.
    if (item.isPlaylist && item.mode === 'library') {
      await downloadPlaylistLibrary(item.album, item.quality, onProgress, onFailure);
      return;
    }

    // Navidrome fix: if no override was provided, auto-detect multi-artist albums
    // and apply a unified Album Artist tag so they don't get split
    let albumArtist = item.albumArtistOverride;
    if (!albumArtist) {
      const multiArtistInfo = detectMultiArtist(item.album);
      if (multiArtistInfo.isMultiArtist) {
        albumArtist = multiArtistInfo.suggestedAlbumArtist;
      }
    }

    if (item.mode === 'zip') {
      await downloadAlbumZip(item.album, item.quality, onProgress, onFailure, albumArtist);
    } else if (item.mode === 'library') {
      await downloadAlbumLibrary(item.album, item.quality, onProgress, onFailure, albumArtist);
    } else {
      await downloadAlbumIndividual(item.album, item.quality, onProgress, onFailure, albumArtist);
    }
  }

  // ── History recording ─────────────────────────────────────────────────────

  private async recordToHistory(item: QueueItem): Promise<void> {
    if (item.type === 'track') {
      await recordDownload({
        saavnId: item.song.id,
        type: 'track',
        title: item.title,
        artist: item.artist,
        album: item.song.more_info?.album || '',
        image: item.song.image || '',
        quality: item.quality,
        mode: '',
        songCount: 0,
        duration: item.song.more_info?.duration || '0',
        playCount: item.song.play_count || '0',
        year: item.song.year || '',
        language: item.song.language || '',
        isExplicit: item.song.isExplicit || false,
      });
    } else {
      // Build per-track data for the album
      // For playlists, only include tracks that were actually downloaded (not skipped as existing)
      const songs = item.album.songs || [];
      const tracks = songs.map((song, idx) => {
        // Try to get filePath from track progress (set during library mode)
        const trackProgress = item.trackProgress?.tracks?.[idx];
        return {
          saavnId: song.id,
          title: song.title,
          artist: song.subtitle?.split(' - ')[0]?.trim() || song.more_info?.artists?.primary?.[0]?.name || '',
          albumTitle: item.isPlaylist ? (song.more_info?.album || item.title) : item.title,
          albumArtist: item.isPlaylist
            ? (song.subtitle?.split(' - ')[0]?.trim() || song.more_info?.artists?.primary?.[0]?.name || '')
            : (item.albumArtistOverride || item.artist),
          duration: song.more_info?.duration || '0',
          playCount: song.play_count || '0',
          year: song.year || item.album.year || '',
          language: song.language || item.album.language || '',
          trackNumber: idx + 1,
          isExplicit: song.isExplicit || false,
          image: song.image || item.album.image || '',
          filePath: trackProgress?.filePath || '',
          skipIfExists: item.isPlaylist || false,
        };
      });

      await recordDownload({
        saavnId: item.album.id,
        type: 'album',
        title: item.title,
        artist: item.artist,
        album: item.title,
        image: item.album.image || '',
        quality: item.quality,
        mode: item.mode,
        songCount: item.album.songs?.length || 0,
        year: item.album.year || '',
        language: item.album.language || '',
        tracks,
      });
    }
  }
}

// ─── Server backend (persistent server-side queue via /api/downloads) ──────────

interface ServerQueueItemDTO {
  id: string;
  type: 'track' | 'album';
  title: string;
  artist: string;
  image: string;
  status: QueueItemStatus;
  progress: number;
  stage: string;
  error?: string;
  addedAt: number;
  quality: string;
  mode?: AlbumDownloadMode;
  isPlaylist?: boolean;
  albumArtistOverride?: string;
  hasArtifact?: boolean;
  artifactName?: string;
  trackProgress?: AlbumDownloadProgress;
}

interface ServerStateDTO {
  items: ServerQueueItemDTO[];
  isProcessing: boolean;
  isPaused: boolean;
}

/** Map a server DTO item into the client QueueItem shape the UI expects. */
function mapServerItem(dto: ServerQueueItemDTO): QueueItem {
  const base = {
    id: dto.id,
    title: dto.title,
    artist: dto.artist,
    image: dto.image,
    status: dto.status,
    progress: dto.progress,
    stage: dto.stage,
    error: dto.error,
    addedAt: dto.addedAt,
    quality: dto.quality as Quality,
    hasArtifact: dto.hasArtifact,
    artifactName: dto.artifactName,
  };

  if (dto.type === 'album') {
    // Synthesize the minimal `album` shape the download manager reads (songs list).
    const songs = (dto.trackProgress?.tracks || []).map((t) => ({ id: t.id, title: t.title }));
    return {
      ...base,
      type: 'album',
      mode: dto.mode || 'library',
      isPlaylist: dto.isPlaylist,
      albumArtistOverride: dto.albumArtistOverride,
      trackProgress: dto.trackProgress,
      album: { title: dto.title, image: dto.image, songs },
    } as unknown as QueueAlbumItem;
  }

  return { ...base, type: 'track' } as unknown as QueueTrackItem;
}

class ServerBackend implements QueueBackend {
  private state: QueueState = { items: [], isProcessing: false, isPaused: false };
  private listeners: Set<QueueListener> = new Set();
  private es: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private everConnected = false;

  constructor() {
    // Fast initial paint, then a live stream (SSE) with a polling fallback.
    void this.refresh();
    this.connect();
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): QueueState {
    return this.state;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private applyServerState(raw: ServerStateDTO): void {
    this.state = {
      items: (raw.items || []).map(mapServerItem),
      isProcessing: !!raw.isProcessing,
      isPaused: !!raw.isPaused,
    };
    this.emit();
  }

  private async refresh(): Promise<void> {
    try {
      const resp = await fetch('/api/downloads');
      if (resp.ok) this.applyServerState(await resp.json());
    } catch {
      /* ignore — SSE/polling will retry */
    }
  }

  private connect(): void {
    if (typeof EventSource !== 'undefined') {
      try {
        this.es = new EventSource('/api/downloads/events');
        this.es.onmessage = (e) => {
          this.everConnected = true;
          try {
            this.applyServerState(JSON.parse(e.data));
          } catch {
            /* ignore malformed frame */
          }
        };
        this.es.onerror = () => {
          // If we never established a stream, SSE is unavailable → poll.
          // If we had connected, let EventSource auto-reconnect (e.g. server restart).
          if (!this.everConnected) {
            this.es?.close();
            this.es = null;
            this.startPolling();
          }
        };
        return;
      } catch {
        /* fall through to polling */
      }
    }
    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.refresh(), 2000);
  }

  // ── Mutations (optimistically apply the returned state) ────────────────────

  private async post(url: string, body?: unknown): Promise<void> {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (resp.ok) this.applyServerState(await resp.json());
    } catch {
      /* the live stream will reconcile */
    }
  }

  private async del(url: string): Promise<void> {
    try {
      const resp = await fetch(url, { method: 'DELETE' });
      if (resp.ok) this.applyServerState(await resp.json());
    } catch {
      /* ignore */
    }
  }

  addTrack(song: SaavnSong, quality: Quality, overrideMeta?: TrackMetadata, overrideFilename?: string): void {
    void this.post('/api/downloads/track', { song, quality, mode: 'library', overrideMeta, overrideFilename });
  }

  addAlbum(
    album: AlbumDetail,
    quality: Quality,
    mode: AlbumDownloadMode,
    albumArtistOverride?: string,
    isPlaylist?: boolean,
  ): void {
    void this.post('/api/downloads/album', { album, quality, mode, albumArtistOverride, isPlaylist });
  }

  removeItem(id: string): void {
    void this.del(`/api/downloads/${encodeURIComponent(id)}`);
  }

  retryItem(id: string): void {
    void this.post(`/api/downloads/${encodeURIComponent(id)}/retry`);
  }

  cancelCurrent(): void {
    const active = this.state.items.find((i) => i.status === 'downloading');
    if (active) void this.post(`/api/downloads/${encodeURIComponent(active.id)}/cancel`);
  }

  clearCompleted(): void {
    void this.post('/api/downloads/clear-completed');
  }

  clearAll(): void {
    void this.post('/api/downloads/clear-all');
  }

  pause(): void {
    void this.post('/api/downloads/pause');
  }

  resume(): void {
    void this.post('/api/downloads/resume');
  }

  moveUp(id: string): void {
    void this.post(`/api/downloads/${encodeURIComponent(id)}/move`, { dir: 'up' });
  }

  moveDown(id: string): void {
    void this.post(`/api/downloads/${encodeURIComponent(id)}/move`, { dir: 'down' });
  }
}

// ─── Router (hybrid: server for library jobs, in-memory for browser-delivery) ──

/**
 * The exported singleton. It always keeps an in-memory backend (used for browser-delivery
 * downloads and as the sole backend on static deployments). When the server reports
 * `serverDownloadsEnabled`, it also attaches a ServerBackend and routes library album /
 * playlist jobs there so they run headless and survive tab closure / restarts. State from
 * both backends is merged for the UI, preserving the QueueState / QueueItem shape.
 */
class QueueRouter implements QueueBackend {
  private memory = new InMemoryBackend();
  private server: ServerBackend | null = null;
  private serverReady = false;

  private listeners: Set<QueueListener> = new Set();
  private memState: QueueState;
  private serverState: QueueState = { items: [], isProcessing: false, isPaused: false };

  constructor() {
    this.memState = this.memory.getState();
    this.memory.subscribe((s) => {
      this.memState = s;
      this.emit();
    });
    void this.detectServer();
  }

  private async detectServer(): Promise<void> {
    try {
      const resp = await fetch('/api/config');
      if (!resp.ok) return;
      const cfg = await resp.json();
      if (cfg?.serverDownloadsEnabled) {
        this.server = new ServerBackend();
        this.serverReady = true;
        this.server.subscribe((s) => {
          this.serverState = s;
          this.emit();
        });
      }
    } catch {
      /* no server (e.g. static deployment) → in-memory only */
    }
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): QueueState {
    const items = [...this.serverState.items, ...this.memState.items].sort((a, b) => a.addedAt - b.addedAt);
    return {
      items,
      isProcessing: this.memState.isProcessing || this.serverState.isProcessing,
      isPaused: this.serverReady ? this.serverState.isPaused : this.memState.isPaused,
    };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  /** Which backend currently owns a given item id. */
  private backendFor(id: string): QueueBackend {
    if (this.server && this.serverState.items.some((i) => i.id === id)) return this.server;
    return this.memory;
  }

  addTrack(song: SaavnSong, quality: Quality, overrideMeta?: TrackMetadata, overrideFilename?: string): void {
    // Tracks are browser-delivery ("Add to Queue" downloads the file). Keep in-browser.
    this.memory.addTrack(song, quality, overrideMeta, overrideFilename);
  }

  addAlbum(
    album: AlbumDetail,
    quality: Quality,
    mode: AlbumDownloadMode,
    albumArtistOverride?: string,
    isPlaylist?: boolean,
  ): void {
    // Route library jobs to the server (headless, restart-safe); browser-delivery
    // (zip / individual) stays in the in-browser pipeline in Phase 1.
    if (mode === 'library' && this.serverReady && this.server) {
      this.server.addAlbum(album, quality, mode, albumArtistOverride, isPlaylist);
    } else {
      this.memory.addAlbum(album, quality, mode, albumArtistOverride, isPlaylist);
    }
  }

  removeItem(id: string): void {
    this.backendFor(id).removeItem(id);
  }

  retryItem(id: string): void {
    this.backendFor(id).retryItem(id);
  }

  cancelCurrent(): void {
    this.memory.cancelCurrent();
    this.server?.cancelCurrent();
  }

  clearCompleted(): void {
    this.memory.clearCompleted();
    this.server?.clearCompleted();
  }

  clearAll(): void {
    this.memory.clearAll();
    this.server?.clearAll();
  }

  pause(): void {
    this.memory.pause();
    this.server?.pause();
  }

  resume(): void {
    this.memory.resume();
    this.server?.resume();
  }

  moveUp(id: string): void {
    this.backendFor(id).moveUp(id);
  }

  moveDown(id: string): void {
    this.backendFor(id).moveDown(id);
  }
}

// Singleton instance
export const downloadQueue = new QueueRouter();
