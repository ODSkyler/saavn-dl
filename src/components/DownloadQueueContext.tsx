import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { downloadQueue } from '../utils/downloadQueue';
import type { QueueState, QueueItem } from '../utils/downloadQueue';
import type { SaavnSong, AlbumDetail, Quality } from '../types/saavn';
import type { TrackMetadata } from '../types/metadata';
import type { AlbumDownloadMode } from '../utils/albumDownload';

// ─── Context shape ────────────────────────────────────────────────────────────

interface DownloadQueueContextValue {
  items: QueueItem[];
  isProcessing: boolean;
  isPaused: boolean;
  activeCount: number;
  queuedCount: number;
  totalPending: number;
  addTrack: (song: SaavnSong, quality: Quality, overrideMeta?: TrackMetadata, overrideFilename?: string) => void;
  addAlbum: (album: AlbumDetail, quality: Quality, mode: AlbumDownloadMode, albumArtistOverride?: string, isPlaylist?: boolean) => void;
  removeItem: (id: string) => void;
  retryItem: (id: string) => void;
  cancelCurrent: () => void;
  clearCompleted: () => void;
  clearAll: () => void;
  pause: () => void;
  resume: () => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  downloadArtifact: (id: string) => void;
}

const DownloadQueueContext = createContext<DownloadQueueContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DownloadQueueProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<QueueState>(downloadQueue.getState());

  useEffect(() => {
    return downloadQueue.subscribe(setState);
  }, []);

  const addTrack = useCallback(
    (song: SaavnSong, quality: Quality, overrideMeta?: TrackMetadata, overrideFilename?: string) => {
      downloadQueue.addTrack(song, quality, overrideMeta, overrideFilename);
    },
    [],
  );

  const addAlbum = useCallback(
    (album: AlbumDetail, quality: Quality, mode: AlbumDownloadMode, albumArtistOverride?: string, isPlaylist?: boolean) => {
      downloadQueue.addAlbum(album, quality, mode, albumArtistOverride, isPlaylist);
    },
    [],
  );

  const removeItem = useCallback((id: string) => downloadQueue.removeItem(id), []);
  const retryItem = useCallback((id: string) => downloadQueue.retryItem(id), []);
  const cancelCurrent = useCallback(() => downloadQueue.cancelCurrent(), []);
  const clearCompleted = useCallback(() => downloadQueue.clearCompleted(), []);
  const clearAll = useCallback(() => downloadQueue.clearAll(), []);
  const pause = useCallback(() => downloadQueue.pause(), []);
  const resume = useCallback(() => downloadQueue.resume(), []);
  const moveUp = useCallback((id: string) => downloadQueue.moveUp(id), []);
  const moveDown = useCallback((id: string) => downloadQueue.moveDown(id), []);
  const downloadArtifact = useCallback((id: string) => downloadQueue.downloadArtifact(id), []);

  const activeCount = state.items.filter((i) => i.status === 'downloading').length;
  const queuedCount = state.items.filter((i) => i.status === 'queued').length;
  const totalPending = activeCount + queuedCount;

  return (
    <DownloadQueueContext.Provider
      value={{
        items: state.items,
        isProcessing: state.isProcessing,
        isPaused: state.isPaused,
        activeCount,
        queuedCount,
        totalPending,
        addTrack,
        addAlbum,
        removeItem,
        retryItem,
        cancelCurrent,
        clearCompleted,
        clearAll,
        pause,
        resume,
        moveUp,
        moveDown,
        downloadArtifact,
      }}
    >
      {children}
    </DownloadQueueContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDownloadQueue(): DownloadQueueContextValue {
  const ctx = useContext(DownloadQueueContext);
  if (!ctx) throw new Error('useDownloadQueue must be used within DownloadQueueProvider');
  return ctx;
}
