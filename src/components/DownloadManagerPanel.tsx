import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDownloadQueue } from './DownloadQueueContext';
import { proxyImage } from '../types/saavn';
import type { QueueItem, QueueAlbumItem } from '../utils/downloadQueue';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function DownloadManagerPanel({ isOpen, onClose }: Props) {
  const {
    items, isPaused,
    removeItem, retryItem, cancelCurrent,
    clearCompleted, clearAll,
    pause, resume, moveUp, moveDown,
    downloadArtifact,
  } = useDownloadQueue();

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeItems = items.filter((i) => i.status === 'downloading');
  const queuedItems = items.filter((i) => i.status === 'queued');
  const completedItems = items.filter((i) => i.status === 'done');
  const failedItems = items.filter((i) => i.status === 'failed' || i.status === 'cancelled');

  const hasFinished = completedItems.length > 0 || failedItems.length > 0;
  const hasItems = items.length > 0;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm border-l border-border bg-[#0a0a0e]/95 backdrop-blur-xl shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-base font-display font-bold text-text-primary">Downloads</h2>
                <p className="text-[11px] font-mono text-white/50 mt-0.5">
                  {activeItems.length > 0
                    ? `${activeItems.length} active · ${queuedItems.length} queued`
                    : items.length === 0
                      ? 'No downloads'
                      : `${completedItems.length} done${failedItems.length > 0 ? ` · ${failedItems.length} failed` : ''}`}
                  {isPaused && ' · Paused'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-white/50 hover:text-text-primary transition-colors rounded-lg hover:bg-white/5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Controls bar */}
            {hasItems && (
              <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border">
                {/* Pause / Resume */}
                <button
                  onClick={isPaused ? resume : pause}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono border transition-all ${isPaused
                      ? 'border-cyan/30 bg-cyan/10 text-cyan'
                      : 'border-border text-white/50 hover:border-white/20 hover:text-white/70'
                    }`}
                >
                  {isPaused ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                  )}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>

                {/* Clear completed */}
                {hasFinished && (
                  <button
                    onClick={clearCompleted}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-white/50 border border-border hover:border-white/20 hover:text-white/70 transition-all"
                  >
                    Clear Done
                  </button>
                )}

                {/* Clear all */}
                <button
                  onClick={clearAll}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-rose/60 border border-border hover:border-rose/30 hover:text-rose hover:bg-rose/5 transition-all ml-auto"
                >
                  Clear All
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20 mb-3">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <p className="text-sm font-display text-white/40">No downloads yet</p>
                  <p className="text-[11px] font-mono text-white/25 mt-1">
                    Songs and albums you queue will appear here
                  </p>
                </div>
              )}

              {/* Active downloads */}
              {activeItems.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  onToggleExpand={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                  onRemove={removeItem}
                  onRetry={retryItem}
                  onCancel={cancelCurrent}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  canMoveUp={false}
                  canMoveDown={false}
                />
              ))}

              {/* Queued — section header */}
              {queuedItems.length > 0 && (
                <p className="text-[10px] font-mono text-white/30 uppercase tracking-wider pt-2 pb-0.5 px-1">
                  Queue ({queuedItems.length})
                </p>
              )}
              {queuedItems.map((item, idx) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  onToggleExpand={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                  onRemove={removeItem}
                  onRetry={retryItem}
                  onCancel={cancelCurrent}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < queuedItems.length - 1}
                />
              ))}

              {/* Failed / Cancelled */}
              {failedItems.length > 0 && (
                <p className="text-[10px] font-mono text-rose/50 uppercase tracking-wider pt-2 pb-0.5 px-1">
                  Failed ({failedItems.length})
                </p>
              )}
              {failedItems.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  onToggleExpand={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                  onRemove={removeItem}
                  onRetry={retryItem}
                  onCancel={cancelCurrent}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  canMoveUp={false}
                  canMoveDown={false}
                />
              ))}

              {/* Completed */}
              {completedItems.length > 0 && (
                <p className="text-[10px] font-mono text-emerald-400/50 uppercase tracking-wider pt-2 pb-0.5 px-1">
                  Completed ({completedItems.length})
                </p>
              )}
              {completedItems.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  onToggleExpand={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                  onRemove={removeItem}
                  onRetry={retryItem}
                  onCancel={cancelCurrent}
                  onMoveUp={moveUp}
                  onMoveDown={moveDown}
                  canMoveUp={false}
                  canMoveDown={false}
                />
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Download row ─────────────────────────────────────────────────────────────

interface DownloadRowProps {
  item: QueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: () => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function DownloadRow({
  item, isExpanded, onToggleExpand,
  onRemove, onRetry, onCancel,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}: DownloadRowProps) {
  const thumbUrl = proxyImage(item.image, '50x50');
  const { downloadArtifact } = useDownloadQueue();

  const statusColor = {
    queued: 'text-white/50',
    downloading: 'text-cyan',
    done: 'text-emerald-400',
    failed: 'text-rose',
    cancelled: 'text-amber-400',
  }[item.status];

  const borderColor = {
    queued: 'border-border',
    downloading: 'border-cyan/20',
    done: 'border-emerald-500/20',
    failed: 'border-rose/20',
    cancelled: 'border-amber-500/20',
  }[item.status];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`rounded-xl border ${borderColor} bg-glass/50 transition-all overflow-hidden`}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 p-2.5">
        {/* Thumbnail */}
        <button onClick={onToggleExpand} className="relative w-10 h-10 rounded-lg overflow-hidden bg-border flex-shrink-0">
          <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
          {item.status === 'downloading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="w-3 h-3 border-2 border-cyan border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {item.status === 'done' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}
          {(item.status === 'failed' || item.status === 'cancelled') && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={item.status === 'cancelled' ? 'text-amber-400' : 'text-rose'}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
          )}
        </button>

        {/* Info */}
        <button onClick={onToggleExpand} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-display font-semibold text-text-primary truncate">
              {item.title}
            </span>
            {item.type === 'album' && (
              <span className="flex-shrink-0 px-1 py-0.5 bg-violet-500/10 border border-violet-500/25 text-violet-300 text-[8px] font-bold font-mono rounded uppercase leading-none">
                Album
              </span>
            )}
          </div>
          <p className="text-[10px] text-white/50 font-body truncate mt-0.5">{item.artist}</p>
          <p className={`text-[10px] font-mono ${statusColor} truncate mt-0.5`}>
            {item.status === 'downloading' ? `${item.stage} · ${Math.round(item.progress)}%` : item.stage}
          </p>
        </button>

        {/* Quick actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {item.status === 'done' && item.hasArtifact && (
            <button
              onClick={() => downloadArtifact(item.id)}
              className="p-1.5 rounded-lg text-cyan/70 hover:text-cyan hover:bg-cyan/10 transition-all"
              title="Download file"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}
          {item.status === 'downloading' && (
            <button
              onClick={onCancel}
              className="p-1.5 rounded-lg text-rose/60 hover:text-rose hover:bg-rose/10 transition-all"
              title="Cancel download"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </button>
          )}
          {(item.status === 'failed' || item.status === 'cancelled') && (
            <button
              onClick={() => onRetry(item.id)}
              className="p-1.5 rounded-lg text-cyan/70 hover:text-cyan hover:bg-cyan/10 transition-all"
              title="Retry"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          {item.status === 'queued' && canMoveUp && (
            <button
              onClick={() => onMoveUp(item.id)}
              className="p-1 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
              title="Move up"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          )}
          {item.status === 'queued' && canMoveDown && (
            <button
              onClick={() => onMoveDown(item.id)}
              className="p-1 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
              title="Move down"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          {item.status !== 'downloading' && (
            <button
              onClick={() => onRemove(item.id)}
              className="p-1.5 rounded-lg text-white/30 hover:text-rose hover:bg-rose/10 transition-all"
              title="Remove"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          {/* Expand chevron */}
          <button
            onClick={onToggleExpand}
            className="p-1 rounded-lg text-white/30 hover:text-white/60 transition-all"
          >
            <motion.svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.15 }}
            >
              <polyline points="6 9 12 15 18 9" />
            </motion.svg>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {item.status === 'downloading' && (
        <div className="px-2.5 pb-2">
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-cyan"
              animate={{ width: `${item.progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
              <ExpandedDetails item={item} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Expanded details ─────────────────────────────────────────────────────────

function ExpandedDetails({ item }: { item: QueueItem }) {
  const modeLabels: Record<string, string> = {
    individual: 'Individual Files',
    zip: 'ZIP Archive',
    library: 'Save to Library',
  };

  return (
    <div className="space-y-2">
      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        <DetailChip label="Quality" value={`${item.type === 'track' ? (item as any).quality : (item as QueueAlbumItem).quality} kbps`} />
        {item.type === 'album' && (
          <>
            <DetailChip label="Mode" value={modeLabels[(item as QueueAlbumItem).mode] || (item as QueueAlbumItem).mode} />
            <DetailChip label="Tracks" value={String((item as QueueAlbumItem).album.songs.length)} />
          </>
        )}
        <DetailChip label="Added" value={formatTime(item.addedAt)} />
      </div>

      {/* Error details */}
      {item.error && (
        <div className="p-2 rounded-lg bg-rose/5 border border-rose/15">
          <p className="text-[10px] font-mono text-rose/80 leading-relaxed break-all">{item.error}</p>
        </div>
      )}

      {/* Album track progress */}
      {item.type === 'album' && (item as QueueAlbumItem).trackProgress && (
        <AlbumTrackList albumItem={item as QueueAlbumItem} />
      )}

      {/* Album song list (when queued, show what will be downloaded) */}
      {item.type === 'album' && item.status === 'queued' && (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider mb-1">Tracks</p>
          {(item as QueueAlbumItem).album.songs.map((song, i) => (
            <div key={song.id} className="flex items-center gap-2 px-1 py-0.5">
              <span className="text-[9px] font-mono text-white/30 w-4 text-right">{i + 1}</span>
              <span className="text-[10px] font-body text-white/60 truncate">{song.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Navidrome info for albums */}
      {item.type === 'album' && (item as QueueAlbumItem).albumArtistOverride && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-violet-500/5 border border-violet-500/15">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" className="flex-shrink-0">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-[9px] font-mono text-violet-300/70">
            Album Artist: {(item as QueueAlbumItem).albumArtistOverride}
          </p>
        </div>
      )}

      {/* Individual-as-zip note (server processing delivers a single archive) */}
      {item.type === 'album' && (item as QueueAlbumItem).mode === 'individual' && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-border">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-white/40">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="text-[9px] font-mono text-white/50">
            When processed on the server, individual files are delivered as a single ZIP.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Album track list (during download) ───────────────────────────────────────

function AlbumTrackList({ albumItem }: { albumItem: QueueAlbumItem }) {
  const tracks = albumItem.trackProgress?.tracks;
  if (!tracks || tracks.length === 0) return null;

  return (
    <div className="space-y-0.5 max-h-32 overflow-y-auto">
      <p className="text-[9px] font-mono text-white/30 uppercase tracking-wider mb-1">Track Progress</p>
      {tracks.map((t) => (
        <div key={t.id} className="flex items-center gap-2 px-1 py-0.5">
          <TrackStatusDot status={t.status} />
          <span className={`text-[10px] font-mono truncate flex-1 ${t.status === 'done' ? 'text-emerald-400/80'
              : t.status === 'failed' ? 'text-rose/80'
                : t.status === 'skipped' ? 'text-white/30 line-through'
                  : t.status === 'downloading' ? 'text-cyan'
                    : 'text-white/50'
            }`}>
            {t.title}
          </span>
          {t.status === 'downloading' && (
            <span className="w-2 h-2 border border-cyan border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

function TrackStatusDot({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending: 'bg-white/20',
    downloading: 'bg-cyan',
    done: 'bg-emerald-400',
    failed: 'bg-rose',
    skipped: 'bg-white/20',
  };
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls[status] || 'bg-white/20'}`} />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DetailChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-surface border border-border rounded-md">
      <span className="text-[8px] font-mono text-white/40 uppercase">{label}</span>
      <span className="text-[9px] font-mono text-white/70">{value}</span>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}
