import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AudioPreviewProps {
  vlink: string;
  title: string;
}

export default function AudioPreview({ vlink, title }: AudioPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePreview = () => {
    if (!isOpen) {
      setIsOpen(true);
      // Auto-play when opening
      setTimeout(() => {
        audioRef.current?.play().catch(() => {});
      }, 300);
    } else {
      setIsOpen(false);
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const ct = audioRef.current.currentTime;
    const d = audioRef.current.duration || 0;
    setCurrentTime(ct);
    setProgress(d > 0 ? (ct / d) * 100 : 0);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <audio
        ref={audioRef}
        src={`https://rthmx.vercel.app/api/media?url=${encodeURIComponent(vlink)}`}
          // Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
          // Visit https://github.com/ODSkyler/jiosaavn-api for more information.
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          setDuration(audioRef.current?.duration || 0);
          setIsLoading(false);
        }}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onEnded={() => { setIsPlaying(false); setProgress(0); setCurrentTime(0); }}
        preload="none"
      />

      <motion.button
        onClick={togglePreview}
        whileTap={{ scale: 0.96 }}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-display font-medium border transition-all duration-200 ${
          isOpen
            ? 'bg-rose/10 border-rose/40 text-rose hover:bg-rose/15'
            : 'bg-glass border-border text-text-secondary hover:border-rose/30 hover:text-rose'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          {isOpen && isPlaying ? (
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          ) : (
            <path d="M5 3l14 9-14 9V3z" />
          )}
        </svg>
        {isOpen ? 'Close' : 'Preview'}
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="bg-glass border border-border rounded-xl p-3 flex items-center gap-3">
              {/* Play/Pause mini button */}
              <motion.button
                onClick={togglePlay}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 flex-shrink-0 rounded-full bg-rose/10 border border-rose/30 text-rose flex items-center justify-center hover:bg-rose/20 transition-colors"
              >
                {isLoading ? (
                  <span className="w-3 h-3 border border-rose border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    {isPlaying ? (
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    ) : (
                      <path d="M5 3l14 9-14 9V3z" />
                    )}
                  </svg>
                )}
              </motion.button>

              {/* Progress */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-text-muted font-mono truncate mb-1.5">{title} · Preview</p>
                <div
                  className="relative h-1 bg-border rounded-full cursor-pointer group"
                  onClick={handleSeek}
                >
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-rose rounded-full"
                    style={{ width: `${progress}%` }}
                    transition={{ duration: 0.1 }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-rose rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-glow-rose"
                    style={{ left: `calc(${progress}% - 5px)` }}
                  />
                </div>
              </div>

              {/* Time */}
              <div className="flex-shrink-0 text-[11px] font-mono text-text-muted tabular-nums">
                {fmt(currentTime)}{duration > 0 && ` / ${fmt(duration)}`}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
