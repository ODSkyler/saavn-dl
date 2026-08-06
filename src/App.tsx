import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SearchBar from './components/SearchBar';
import TrackCard from './components/TrackCard';
import TrackSkeleton from './components/TrackSkeleton';
import SearchResults from './components/SearchResults';
import AlbumPage from './components/album/AlbumPage';
import AlbumSkeleton from './components/album/AlbumSkeleton';
import AlbumResultCard from './components/album/AlbumResultCard';
import type { SaavnSong, SearchResult, AlbumSearchResult, AlbumDetail } from './types/saavn';
import { searchSongs } from './utils/search';
import { searchAlbums, fetchAlbumDetail } from './utils/album';

// ─── Constants ────────────────────────────────────────────────────────────────

const SONG_API = 'https://sda.rhythmax.workers.dev';
  // Defalut API (sda.rhythmax.workers.dev). Replace with your saavn-dl-api instance.
  // Visit https://github.com/ODSkyler/saavn-dl-api for more information.

// ─── Search tab ───────────────────────────────────────────────────────────────

type SearchTab = 'songs' | 'albums';

// ─── View state machine ───────────────────────────────────────────────────────

type View =
  | { type: 'idle' }
  // ── Song flows ──
  | { type: 'fetching-song' }
  | { type: 'track'; song: SaavnSong; fromSearch: boolean }
  | { type: 'searching-songs'; query: string }
  | { type: 'song-results'; results: SearchResult[]; query: string }
  | { type: 'fetching-song-result'; results: SearchResult[]; query: string; fetchingId: string }
  // ── Album flows ──
  | { type: 'fetching-album' }
  | { type: 'album'; album: AlbumDetail; fromSearch: boolean }
  | { type: 'searching-albums'; query: string }
  | { type: 'album-results'; results: AlbumSearchResult[]; query: string }
  | { type: 'fetching-album-result'; results: AlbumSearchResult[]; query: string; fetchingId: string }
  // ── Errors ──
  | { type: 'error'; message: string; context: 'url' | 'search' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchSong(url: string): Promise<SaavnSong> {
  const resp = await fetch(`${SONG_API}/song?url=${encodeURIComponent(url)}`);
  if (!resp.ok) throw new Error((await resp.text().catch(() => '')) || `HTTP ${resp.status}`);
  const data: SaavnSong = await resp.json();
  if (!data?.id || !data?.more_info?.encrypted_media_url)
    throw new Error('Invalid response — missing required fields');
  return data;
}

// ─── App ──────────────────────────────────────────────────────────────────────

interface UpdateItem { id: string; title: string; date: string; content: string; }

export default function App() {
  const [view, setView]           = useState<View>({ type: 'idle' });
  const [searchTab, setSearchTab] = useState<SearchTab>('songs');
  const [searchError, setSearchError] = useState('');
  const [showUpdates, setShowUpdates] = useState(false);
  const [updates, setUpdates]     = useState<UpdateItem[]>([]);
  const [showSupport, setShowSupport] = useState(false);
  const [showSupportPrompt, setShowSupportPrompt] = useState(false);
  const lastSongSearch  = useRef<{ results: SearchResult[];       query: string } | null>(null);
  const lastAlbumSearch = useRef<{ results: AlbumSearchResult[];  query: string } | null>(null);

  useEffect(() => {
    fetch('/updates.json').then(r => r.json()).then(setUpdates).catch(() => {});
  }, []);

  // ── Song URL fetch ────────────────────────────────────────────────────────

  const handleUrlFetch = useCallback(async (url: string) => {
    setView({ type: 'fetching-song' });
    setSearchError('');
    try {
      const song = await fetchSong(url);
      setView({ type: 'track', song, fromSearch: false });
    } catch (err) {
      setView({ type: 'error', message: err instanceof Error ? err.message : 'Fetch failed', context: 'url' });
    }
  }, []);

  // ── Album URL fetch ───────────────────────────────────────────────────────

  const handleAlbumFetch = useCallback(async (url: string) => {
    setView({ type: 'fetching-album' });
    setSearchError('');
    try {
      const album = await fetchAlbumDetail(url);
      setView({ type: 'album', album, fromSearch: false });
    } catch (err) {
      setView({ type: 'error', message: err instanceof Error ? err.message : 'Album fetch failed', context: 'url' });
    }
  }, []);

  // ── Search (songs or albums) ──────────────────────────────────────────────

  const handleSearch = useCallback(async (query: string) => {
    setSearchError('');

    if (searchTab === 'songs') {
      setView({ type: 'searching-songs', query });
      try {
        const results = await searchSongs(query);
        lastSongSearch.current = { results, query };
        setView({ type: 'song-results', results, query });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Search failed';
        setSearchError(msg);
        setView({ type: 'error', message: msg, context: 'search' });
      }
    } else {
      setView({ type: 'searching-albums', query });
      try {
        const results = await searchAlbums(query);
        lastAlbumSearch.current = { results, query };
        setView({ type: 'album-results', results, query });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Album search failed';
        setSearchError(msg);
        setView({ type: 'error', message: msg, context: 'search' });
      }
    }
  }, [searchTab]);

  // ── Song result select → re-fetch full song ───────────────────────────────

  const handleSongResultSelect = useCallback(async (result: SearchResult) => {
    const currentResults = view.type === 'song-results' || view.type === 'fetching-song-result' ? view.results : [];
    const currentQuery   = view.type === 'song-results' || view.type === 'fetching-song-result' ? view.query : '';
    setView({ type: 'fetching-song-result', results: currentResults, query: currentQuery, fetchingId: result.id });
    setSearchError('');
    try {
      const song = await fetchSong(result.perma_url);
      setView({ type: 'track', song, fromSearch: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load song';
      setSearchError(msg);
      setView({ type: 'song-results', results: currentResults, query: currentQuery });
    }
  }, [view]);

  // ── Album result select → fetch album detail ──────────────────────────────

  const handleAlbumResultSelect = useCallback(async (result: AlbumSearchResult) => {
    const currentResults = view.type === 'album-results' || view.type === 'fetching-album-result' ? view.results : [];
    const currentQuery   = view.type === 'album-results' || view.type === 'fetching-album-result' ? view.query : '';
    setView({ type: 'fetching-album-result', results: currentResults, query: currentQuery, fetchingId: result.id });
    setSearchError('');
    try {
      const album = await fetchAlbumDetail(result.perma_url);
      setView({ type: 'album', album, fromSearch: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load album';
      setSearchError(msg);
      setView({ type: 'album-results', results: currentResults, query: currentQuery });
    }
  }, [view]);

  // ── Back to results ───────────────────────────────────────────────────────

  const goBack = () => {
    setSearchError('');
    if (view.type === 'track' && view.fromSearch && lastSongSearch.current) {
      setView({ type: 'song-results', ...lastSongSearch.current });
    } else if (view.type === 'album' && view.fromSearch && lastAlbumSearch.current) {
      setView({ type: 'album-results', ...lastAlbumSearch.current });
    } else {
      setView({ type: 'idle' });
    }
  };

  // ── Support prompt ───────────────────────────────────────────────────────

  const maybeShowSupportPrompt = () => {
  const shown = localStorage.getItem("saavn-dl-support-shown");

  if (!shown) {
    setShowSupportPrompt(true);
    localStorage.setItem("saavn-dl-support-shown", "true");
  }
};

  // ── Derived ───────────────────────────────────────────────────────────────

  const isFetchingUrl   = view.type === 'fetching-song' || view.type === 'fetching-album';
  const isSearching     = view.type === 'searching-songs' || view.type === 'searching-albums';
  const isFetchingResult = view.type === 'fetching-song-result' || view.type === 'fetching-album-result';
  const isAnyLoading    = isFetchingUrl || isSearching || isFetchingResult;
  const showSongResults  = ['searching-songs', 'song-results', 'fetching-song-result'].includes(view.type) || (view.type === 'error' && view.context === 'search' && searchTab === 'songs');
  const showAlbumResults = ['searching-albums', 'album-results', 'fetching-album-result'].includes(view.type) || (view.type === 'error' && view.context === 'search' && searchTab === 'albums');
  const showSearch = showSongResults || showAlbumResults;

  return (
    <div className="min-h-screen bg-void relative overflow-x-hidden">
      {/* Ambient bg */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-mesh-cyan" />
        <div className="absolute inset-0 bg-mesh-rose" />
        <div className="absolute inset-0 opacity-[0.012]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
      </div>

      <div className="relative z-10 flex flex-col items-center min-h-screen px-4 py-10 sm:py-16">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <h1 className="text-2xl font-display font-bold text-text-primary tracking-tight">
              saavn<span className="text-cyan">-dl</span>
            </h1>
          </div>
          <p className="text-[13px] text-white/60 font-body">
            Download songs &amp; albums from JioSaavn · up to <span className="text-cyan font-mono">320 kbps</span>
          </p>
        </motion.div>

        {/* Search bar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="w-full max-w-2xl">
          <SearchBar
            onUrlFetch={handleUrlFetch}
            onAlbumFetch={handleAlbumFetch}
            onSearch={handleSearch}
            isLoading={isAnyLoading}
          />
        </motion.div>

        {/* Search mode tabs — visible while search results/idle are shown */}
        <AnimatePresence>
          {(showSearch || view.type === 'idle') && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-2xl mt-4 flex gap-1"
            >
              {(['songs', 'albums'] as SearchTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSearchTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-[12px] font-display font-semibold capitalize transition-all duration-150 ${
                    searchTab === tab
                      ? tab === 'albums'
                        ? 'bg-cyan/10 border border-cyan/50 text-cyan'
                        : 'bg-cyan/10 border border-cyan/30 text-cyan'
                      : 'border border-transparent text-text-muted hover:text-text-secondary hover:border-border'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content area */}
        <div className="w-full max-w-2xl mt-5">
          <AnimatePresence mode="wait">

            {/* URL loading skeletons */}
            {view.type === 'fetching-song' && (
              <motion.div key="song-skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TrackSkeleton />
              </motion.div>
            )}
            {view.type === 'fetching-album' && (
              <motion.div key="album-skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AlbumSkeleton />
              </motion.div>
            )}

            {/* URL/generic error */}
            {view.type === 'error' && view.context === 'url' && (
              <FetchError key="url-error" message={view.message} />
            )}

            {/* Song TrackCard */}
            {view.type === 'track' && (
              <motion.div key={`track-${view.song.id}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
                {view.fromSearch && <BackBtn onClick={goBack} label="Back to results" />}
                <TrackCard song={view.song} onDownloadSuccess={maybeShowSupportPrompt} />
              </motion.div>
            )}

            {/* Album page */}
            {view.type === 'album' && (
              <motion.div key={`album-${view.album.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AlbumPage album={view.album} onBack={view.fromSearch ? goBack : undefined} />
              </motion.div>
            )}

            {/* Song search results */}
            {showSongResults && (
              <motion.div key="song-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SearchResults
                  results={view.type === 'song-results' || view.type === 'fetching-song-result' ? view.results : []}
                  query={
                    view.type === 'searching-songs'        ? view.query
                    : view.type === 'song-results'         ? view.query
                    : view.type === 'fetching-song-result' ? view.query
                    : ''
                  }
                  isSearching={view.type === 'searching-songs'}
                  fetchingId={view.type === 'fetching-song-result' ? view.fetchingId : null}
                  onSelect={handleSongResultSelect}
                  error={view.type === 'error' && view.context === 'search' ? view.message : ''}
                />
              </motion.div>
            )}

            {/* Album search results */}
            {showAlbumResults && (
              <motion.div key="album-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AlbumResultsPanel
                  view={view}
                  onSelect={handleAlbumResultSelect}
                />
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="mt-auto pt-16 flex items-center justify-center gap-4">
          <a href="https://github.com/ODSkyler/saavn-dl" target="_blank" rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 transition-all duration-200" aria-label="GitHub">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.866-.013-1.699-2.782.605-3.37-1.343-3.37-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.523 2 12 2z"/>
            </svg>
          </a>
          <a href="https://discord.gg/NcvrpP6bU3" target="_blank" rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-[#5865F2] hover:border-[#5865F2]/30 hover:bg-[#5865F2]/10 transition-all duration-200" aria-label="Discord">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.222 4.779a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.249.077.077 0 0 0-.078-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.17.099 17.243a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.027 13.83 13.83 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.04.106c.36.698.771 1.364 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .031-.055c.5-4.708-.838-8.795-3.548-12.433a.061.061 0 0 0-.031-.028zM8.02 14.307c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.947 2.419-2.157 2.419z"/>
            </svg>
          </a>
          <button onClick={() => setShowUpdates(true)}
            className="w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-cyan hover:border-cyan/30 hover:bg-cyan/10 transition-all duration-200" aria-label="Updates">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </button>
          {/* Support */}
          <button onClick={() => setShowSupport(true)}
            className="w-10 h-10 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-pink-400 hover:border-pink-400/30 hover:bg-pink-500/10 transition-all duration-200"
            aria-label="Support">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"></path><path d="m14.45 13.39 5.05-4.694C20.196 8 21 6.85 21 5.75a2.75 2.75 0 0 0-4.797-1.837.276.276 0 0 1-.406 0A2.75 2.75 0 0 0 11 5.75c0 1.2.802 2.248 1.5 2.946L16 11.95M2 15l6 6"></path><path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a1 1 0 0 0-2.75-2.91"></path></svg>
</button>
        </motion.div>

        {/* Updates modal */}
        <AnimatePresence>{showUpdates && (<motion.div
initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.2 }}
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
>
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/80 backdrop-blur-xl p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-display font-bold text-text-primary">Updates</h2>
                <button onClick={() => setShowUpdates(false)} className="text-text-muted hover:text-white transition-colors">✕</button>
              </div>
              <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {updates.map((u: UpdateItem) => (
                  <div key={u.id} className="rounded-2xl border border-border bg-glass p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-text-primary">{u.title}</p>
                      <span className="text-[10px] font-mono text-cyan/80">{u.date}</span>
                    </div>
                    <p className="mt-1 text-xs text-white/90">{u.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
        </AnimatePresence>

        {/* Support modal */}
        <AnimatePresence>
        {showSupport && (
         <motion.div
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
           transition={{ duration: 0.2 }}
           className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
         >
           <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/80 backdrop-blur-xl p-6 shadow-2xl">

            <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-bold text-text-primary">
            Support saavn-dl
            </h2>

            <button
            onClick={() => setShowSupport(false)}
            className="text-text-muted hover:text-white transition-colors"
            >
           ✕
        </button>
      </div>

      <p className="mt-4 text-sm text-white/80 leading-relaxed">
        If saavn-dl has been useful to you and you'd like to help cover
        hosting costs, you can support the project using UPI.
      </p>

      {/* QR Code */}
<div className="mt-6 flex justify-center">
  <img
    src="/support-via-upi.jpg"
    alt="Support via UPI"
    className="w-56 rounded-2xl border border-white/10"
  />
</div>

<p className="mt-5 text-center text-sm text-white/80">
  Ko-fi support will be available soon ☕
</p>

<p className="mt-2 text-center text-xs text-white/50">
  For now, you can support the project by scanning the UPI QR code above.
</p>

<p className="mt-5 text-center text-xs text-white/50">
  Donations are completely optional ❤️<br />
  Every contribution helps cover hosting and development costs.
</p>

    </div>
  </motion.div>
)}
        </AnimatePresence>

        <AnimatePresence>
  {showSupportPrompt && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
    >
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-black/80 backdrop-blur-xl p-6 shadow-2xl">

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-bold text-white">
            ❤️ Enjoying saavn-dl?
          </h2>

          <button
            onClick={() => setShowSupportPrompt(false)}
            className="text-white/50 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-sm text-white/80 leading-relaxed">
          If saavn-dl has been useful to you, consider supporting the project.
          Every contribution helps cover hosting and development costs.
        </p>

        <div className="mt-6 flex gap-3">
          <button
  onClick={() => {
    setShowSupportPrompt(false);
    setShowSupport(true);
  }}
  className="flex-1 rounded-xl bg-cyan text-black font-semibold py-3 hover:bg-cyan-dim transition flex items-center justify-center gap-2"
>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"strokeWidth="2" viewBox="0 0 24 24" className="flex-shrink-0">
    <path d="M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"></path>
    <path d="m14.45 13.39 5.05-4.694C20.196 8 21 6.85 21 5.75a2.75 2.75 0 0 0-4.797-1.837.276.276 0 0 1-.406 0A2.75 2.75 0 0 0 11 5.75c0 1.2.802 2.248 1.5 2.946L16 11.95"></path>
    <path d="M2 15l6 6"></path>
    <path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a1 1 0 0 0-2.75-2.91"></path>
  </svg>
  <span>Support</span>
</button>

          <button
            onClick={() => setShowSupportPrompt(false)}
            className="flex-1 rounded-xl border border-border text-white/70 hover:text-white hover:border-white/20 transition"
          >
            Maybe later
          </button>
        </div>

      </div>
    </motion.div>
  )}
</AnimatePresence>

      </div>
    </div>
  );
}

// ─── Album results panel ──────────────────────────────────────────────────────

type AlbumView = Extract<View, { type: 'searching-albums' | 'album-results' | 'fetching-album-result' | 'error' }>;

function AlbumResultsPanel({
  view,
  onSelect,
}: {
  view: View;
  onSelect: (r: AlbumSearchResult) => void;
}) {
  const isSearching  = view.type === 'searching-albums';
  const results      = view.type === 'album-results' || view.type === 'fetching-album-result' ? view.results : [];
  const query        = view.type === 'searching-albums' ? view.query : view.type === 'album-results' || view.type === 'fetching-album-result' ? view.query : '';
  const fetchingId   = view.type === 'fetching-album-result' ? view.fetchingId : null;
  const isFetching   = fetchingId !== null;
  const error        = view.type === 'error' && view.context === 'search' ? view.message : '';

  const shimmer = { background: 'linear-gradient(90deg,#1e1e28 0%,#2a2a38 50%,#1e1e28 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.8s ease-in-out infinite' };

  if (isSearching) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-[11px] font-mono text-violet-400 truncate">Searching albums for "{query}"…</span>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.055 }}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-glass">
            <div className="w-12 h-12 rounded-lg flex-shrink-0" style={shimmer} />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 rounded w-3/5" style={shimmer} />
              <div className="h-3 rounded w-2/5" style={shimmer} />
            </div>
            <div className="h-3 w-9 rounded" style={shimmer} />
          </motion.div>
        ))}
      </div>
    );
  }

  if (error && results.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="flex items-start gap-3 p-4 rounded-xl border border-rose/20 bg-rose/5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2" className="flex-shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div>
          <p className="text-sm font-display font-semibold text-rose">Album search failed</p>
          <p className="text-xs font-mono text-rose/70 mt-0.5">{error}</p>
        </div>
      </motion.div>
    );
  }

  if (!results.length && query) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-12">
        <p className="text-3xl mb-3">💿</p>
        <p className="text-sm font-display font-semibold text-text-secondary">No albums found for "{query}"</p>
        <p className="text-xs font-mono text-text-muted mt-1.5">Try different keywords</p>
      </motion.div>
    );
  }

  if (!results.length) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider flex-shrink-0">Albums for</span>
          <span className="text-[11px] font-mono text-cyan truncate">"{query}"</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFetching && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[11px] font-mono text-violet-400/70 flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
              Loading…
            </motion.span>
          )}
          <span className="text-[11px] font-mono text-text-muted">{results.length} albums</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {results.map((album, i) => (
          <AlbumResultCard
            key={album.id}
            album={album}
            index={i}
            onSelect={onSelect}
            isLoading={fetchingId === album.id}
            anyLoading={isFetching}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function BackBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} onClick={onClick}
      className="mb-3 flex items-center gap-1.5 text-[12px] font-mono text-text-muted hover:text-violet-400 transition-colors group">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
      {label}
    </motion.button>
  );
}

function FetchError({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="rounded-2xl border border-rose/20 bg-rose/5 p-5 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-rose/10 border border-rose/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div>
        <p className="text-sm font-display font-semibold text-rose">Failed to fetch</p>
        <p className="text-xs font-mono text-rose/70 mt-0.5">{message}</p>
      </div>
    </motion.div>
  );
}
