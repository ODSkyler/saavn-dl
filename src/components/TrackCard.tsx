import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SaavnSong, Quality } from '../types/saavn';
import AudioPreview from './AudioPreview';
import QualitySelector from './QualitySelector';
import DownloadButton from './DownloadButton';
import MetadataEditor from './MetadataEditor';
import { buildDefaultMetadata, metadataIsModified } from '../types/metadata';
import type { TrackMetadata } from '../types/metadata';

interface TrackCardProps {
  song: SaavnSong;
  onDownloadSuccess?: () => void;
}

function formatDuration(seconds: string): string {
  const s = parseInt(seconds, 10);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatPlays(n: string): string {
  const num = parseInt(n, 10);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return n;
}

export default function TrackCard({ song, onDownloadSuccess }: TrackCardProps) {
  const [quality, setQuality] = useState<Quality>('320');
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { more_info } = song;
  const primaryArtists = more_info.artists.primary.map((a) => a.name).join(', ');
  const imageUrl =
  `https://rthmx.vercel.app/api/image?url=${encodeURIComponent(song.image)}`;
  // Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
  // Visit https://github.com/ODSkyler/jiosaavn-api for more information.
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [originalMeta, setOriginalMeta] = useState<TrackMetadata | null>(null);
  const [editedMeta, setEditedMeta] = useState<TrackMetadata | null>(null);
  useEffect(() => {
  const meta = buildDefaultMetadata(song);

  setOriginalMeta(meta);
  setEditedMeta(meta);
  }, [song.id]);

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full rounded-2xl border border-border bg-glass overflow-hidden"
      style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 8px 48px rgba(0,0,0,0.6)' }}
    >
      {/* Top section */}
      <div className="p-5">
        <div className="flex gap-5">
          {/* Album Art */}
          <div className="relative flex-shrink-0">
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl overflow-hidden bg-border">
              {!imgLoaded && !imgError && (
                <div className="w-full h-full bg-border animate-pulse rounded-xl" />
              )}
              {!imgError && (
                <img
                  src={imageUrl}
                  alt={more_info.album}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  className={`w-full h-full object-cover transition-opacity duration-300 ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              )}
              {imgError && (
                <div className="w-full h-full flex items-center justify-center text-white/60">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="3" />
                    <line x1="12" y1="2" x2="12" y2="5" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </div>
              )}
            </div>
            {/* Language badge */}
            <div className="absolute -bottom-1.5 -right-1.5 px-1.5 py-0.5 bg-void border border-border rounded-md text-[10px] font-mono text-text-muted uppercase">
              {song.language}
            </div>
          </div>

          {/* Meta */}
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
              <div className="flex items-start gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-display font-bold text-text-primary leading-tight">
                  {song.title}
                </h2>
                {song.isExplicit && (
                  <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 bg-rose/10 border border-rose/30 text-rose text-[10px] font-bold font-mono rounded uppercase tracking-wider">
                    E
                  </span>
                )}
              </div>

              <p className="mt-1 text-sm text-white/60 font-body truncate">
                    {
                    song.subtitle
                    ?.split(' - ')[0]
                    ?.trim() || primaryArtists
                   }
              </p>

              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <MetaChip icon="💿" label={more_info.album} />
                <MetaChip icon="📅" label={song.year} />
                <MetaChip icon="⏱" label={formatDuration(more_info.duration)} />
                {song.play_count && (
                  <MetaChip icon="▶" label={`${formatPlays(song.play_count)} plays`} />
                )}
              </div>
            </div>

            {/* Preview + Metadata */}
            <div className="mt-3 flex items-center gap-3">
              <button
  onClick={() => setShowMetadataEditor(true)}
  className={`px-4 py-2 rounded-xl border transition-all duration-200 text-sm font-display font-medium border whitespace-nowrap ${
    originalMeta &&
    editedMeta &&
    metadataIsModified(originalMeta, editedMeta)
      ? 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10'
      : 'border-border bg-glass text-white/40 hover:border-cyan/30 hover:text-white/60'
  }`}
>
  {originalMeta &&
  editedMeta &&
  metadataIsModified(originalMeta, editedMeta)
    ? 'Meta Updated'
    : 'Edit Meta'}
</button>
             <div className="flex-1">
                 {more_info?.vlink?.trim() ? (
                 <AudioPreview
                  vlink={more_info.vlink}
                  title={song.title}
               />
          ) : (
              <div className="rounded-2xl border border-border bg-glass px-4 py-3 text-center">
                   <p className="text-sm text-white/50">
                  Preview not available for this track
                   </p>
                </div>
                )}
             </div>
           </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border mx-5" />

      {/* Quality + Download */}
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] font-mono text-white/80 uppercase tracking-wider">Quality</span>
          <QualitySelector selected={quality} onChange={setQuality} />
        </div>

        <DownloadButton
  song={song}
  quality={quality}
  onDownloadSuccess={onDownloadSuccess}
  overrideMeta={
    originalMeta &&
    editedMeta &&
    metadataIsModified(originalMeta, editedMeta)
      ? editedMeta
      : undefined
  }
  overrideFilename={
    originalMeta &&
    editedMeta &&
    metadataIsModified(originalMeta, editedMeta)
      ? editedMeta.filename
      : undefined
  }
/>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
        <a
          href={song.perma_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] font-mono text-white/60 hover:text-cyan transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open on JioSaavn
        </a>
        <span className="text-white/30 text-[11px]">·</span>
        <span className="text-[11px] font-mono text-white/40">{more_info.copyright_text}</span>
      </div>
</motion.div>

<AnimatePresence>
  {showMetadataEditor && originalMeta && editedMeta && (
    <MetadataEditor
      original={originalMeta}
      current={editedMeta}
      onUpdate={(meta) => {
        setEditedMeta(meta);
        setShowMetadataEditor(false);
      }}
      onReset={() => {
        setEditedMeta(originalMeta);
        setShowMetadataEditor(false);
      }}
      onClose={() => setShowMetadataEditor(false)}
    />
  )}
</AnimatePresence>

</>
);
}

function MetaChip({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 bg-surface border border-border rounded-md">
      <span className="text-[11px]">{icon}</span>
      <span className="text-[11px] font-mono text-text-secondary truncate max-w-[120px]">{label}</span>
    </div>
  );
}
