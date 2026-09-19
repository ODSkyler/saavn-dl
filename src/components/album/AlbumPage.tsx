import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AlbumDetail, SaavnSong } from '../../types/saavn';
import { albumImage, proxyImage, totalAlbumDuration, formatDuration } from '../../types/saavn';
import AudioPreview from '../AudioPreview';
import DownloadButton from '../DownloadButton';
import QualitySelector from '../QualitySelector';
import AlbumDownloadModal from './AlbumDownloadModal';
import type { Quality } from '../../types/saavn';

interface Props {
  album: AlbumDetail;
  onBack?: () => void;
}

export default function AlbumPage({ album, onBack }: Props) {
  const [showModal, setShowModal]       = useState(false);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [globalQuality, setGlobalQuality] = useState<Quality>('320');
  const [imgError, setImgError]         = useState(false);
  const [imgLoaded, setImgLoaded]       = useState(false);

  const coverUrl   = albumImage(album.image);
  const artists    = album.artists?.primary?.map(a => a.name).join(', ') || album.subtitle;
  const totalDur   = totalAlbumDuration(album.songs);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        className="w-full"
      >
        {/* ── Back button ─────────────────────────────────────────────────── */}
        {onBack && (
          <motion.button
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={onBack}
            className="mb-4 flex items-center gap-1.5 text-[12px] font-mono text-white/60 hover:text-violet-400 transition-colors group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className="group-hover:-translate-x-0.5 transition-transform">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to results
          </motion.button>
        )}

        {/* ── Album hero ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-glass overflow-hidden" style={{
          boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 8px 48px rgba(0,0,0,0.6)'
        }}>
          <div className="p-5">
            <div className="flex gap-5 flex-col sm:flex-row">
              {/* Cover art */}
              <div className="relative flex-shrink-0 mx-auto sm:mx-0">
                <div className="w-40 h-40 sm:w-52 sm:h-52 rounded-xl overflow-hidden bg-border">
                  {!imgLoaded && !imgError && (
                    <div className="w-full h-full animate-pulse bg-border" />
                  )}
                  {!imgError && (
                    <img
                      src={coverUrl}
                      alt={album.title}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => setImgError(true)}
                      className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                    />
                  )}
                  {imgError && (
                    <div className="w-full h-full flex items-center justify-center text-white/60/30">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    </div>
                  )}
                </div>
                {/* Language badge */}
                {album.language && (
                  <div className="absolute -bottom-1.5 -right-1.5 px-1.5 py-0.5 bg-void border border-border rounded-md text-[10px] font-mono text-white/60 uppercase">
                    {album.language}
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  {/* Album label */}
                  <p className="text-[10px] font-mono text-violet-400 uppercase tracking-widest mb-1">Album</p>

                  {/* Title */}
                  <h2 className="text-xl sm:text-2xl font-display font-bold text-text-primary leading-tight">
                    {album.title}
                  </h2>

                  {/* Artists */}
                  <p className="mt-1.5 text-sm text-text-secondary font-body">{artists}</p>

                  {/* Meta chips */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <MetaChip icon="📅" label={album.year} />
                    <MetaChip icon="🎵" label={`${album.song_count} tracks`} />
                    <MetaChip icon="⏱" label={totalDur} />
                    {album.language && <MetaChip icon="🌐" label={album.language} />}
                  </div>

                  {/* Copyright */}
                  {album.copyright && (
                    <p className="mt-3 text-[10px] font-mono text-white/60 leading-relaxed line-clamp-2">{album.copyright}</p>
                  )}
                </div>

                {/* Download album button */}
                <div className="mt-4">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan hover:bg-cyan-dim text-black text-sm font-display font-semibold transition-all duration-200"
                    style={{ boxShadow: '0 0 20px rgba(0,212,255,0.25)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download Album
                  </motion.button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Divider ──────────────────────────────────────────────────── */}
          <div className="h-px bg-border mx-5" />

          {/* ── Global quality for per-track downloads ────────────────────── */}
          <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-mono text-white/60 uppercase tracking-wider">Track Quality</span>
            <QualitySelector selected={globalQuality} onChange={setGlobalQuality} />
          </div>

          <div className="h-px bg-border mx-5" />

          {/* ── Track list ───────────────────────────────────────────────── */}
          <div className="px-3 py-3 space-y-0.5">
            {album.songs.map((song, index) => (
              <TrackRow
                key={song.id}
                song={song}
                index={index}
                quality={globalQuality}
                isExpanded={expandedId === song.id}
                onToggle={() => setExpandedId(prev => prev === song.id ? null : song.id)}
              />
            ))}
          </div>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <div className="px-5 py-3 border-t border-border">
            <a
              href={album.perma_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] font-mono text-white/60 hover:text-violet-400 transition-colors w-fit"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Open on JioSaavn
            </a>
          </div>
        </div>
      </motion.div>

      {/* ── Download modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <AlbumDownloadModal album={album} onClose={() => setShowModal(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────

interface TrackRowProps {
  song: SaavnSong;
  index: number;
  quality: Quality;
  isExpanded: boolean;
  onToggle: () => void;
}

function TrackRow({ song, index, quality, isExpanded, onToggle }: TrackRowProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const duration  = song.more_info?.duration ? formatDuration(song.more_info.duration) : null;
  const artist    = song.subtitle?.split(' - ')[0]?.trim()
    || song.more_info?.artists?.primary?.[0]?.name
    || '';

  const thumbUrl = proxyImage(song.image, '150x150');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
      className={`rounded-xl border transition-all duration-200 ${
        isExpanded ? 'border-border bg-surface' : 'border-transparent hover:border-border hover:bg-surface/60'
      }`}
    >
      {/* Row header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* Track number */}
        <span className="w-5 flex-shrink-0 text-center text-[11px] font-mono text-white/60">
          {index + 1}
        </span>

        {/* Thumbnail */}
        <div className="relative flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-border">
          {!imgLoaded && !imgError && <div className="absolute inset-0 bg-border animate-pulse" />}
          {!imgError && (
            <img
              src={thumbUrl}
              alt={song.title}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
          {imgError && (
            <div className="w-full h-full flex items-center justify-center text-white/60/30">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
          )}
        </div>

        {/* Title + artist */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-display font-semibold text-text-primary truncate leading-tight">
              {song.title}
            </span>
            {song.isExplicit && (
              <span className="flex-shrink-0 px-1 py-0.5 bg-rose/10 border border-rose/25 text-rose text-[9px] font-bold font-mono rounded uppercase leading-none">E</span>
            )}
          </div>
          {artist && (
            <p className="text-[11px] text-text-secondary font-body truncate mt-0.5">{artist}</p>
          )}
        </div>

        {/* Right: duration + expand chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {duration && (
            <span className="text-[11px] font-mono text-white/60 tabular-nums">{duration}</span>
          )}
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.18 }}
            className="text-white/60"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </motion.span>
        </div>
      </button>

      {/* Expanded actions */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              <div className="h-px bg-border" />
              {/* Preview */}
              {song.more_info?.preview && (
                <AudioPreview vlink={song.more_info.preview} title={song.title} />
              )}
              {/* Download */}
              <DownloadButton song={song} quality={quality} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── MetaChip ────────────────────────────────────────────────────────────────

function MetaChip({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 bg-surface border border-border rounded-md">
      <span className="text-[11px]">{icon}</span>
      <span className="text-[11px] font-mono text-text-secondary max-w-[120px] truncate">{label}</span>
    </div>
  );
}
