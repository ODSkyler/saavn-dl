import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SearchBar from './components/SearchBar';
import TrackCard from './components/TrackCard';
import TrackSkeleton from './components/TrackSkeleton';
import SearchResults from './components/SearchResults';
import AlbumPage from './components/album/AlbumPage';
import AlbumSkeleton from './components/album/AlbumSkeleton';
import AlbumResultCard from './components/album/AlbumResultCard';
import LibraryPage from './components/library/LibraryPage';
import HistoryPage from './components/history/HistoryPage';
import ArtistPage from './components/artist/ArtistPage';
import ArtistResultCard from './components/artist/ArtistResultCard';
import PlaylistResultCard from './components/playlist/PlaylistResultCard';
import PlaylistPage from './components/playlist/PlaylistPage';
import DiscoverPage from './components/discover/DiscoverPage';
import PlaylistsPage from './components/playlists/PlaylistsPage';
import PrimaryNav from './components/nav/PrimaryNav';
import { DownloadQueueProvider } from './components/DownloadQueueContext';
import { DownloadPrefsProvider } from './components/DownloadPrefsContext';
import DownloadIndicator from './components/DownloadIndicator';
import DownloadManagerPanel from './components/DownloadManagerPanel';
import type { SaavnSong, SearchResult, AlbumSearchResult, AlbumDetail, ArtistSearchResult, ArtistDetail, PlaylistSearchResult, PlaylistDetail } from './types/saavn';
import { searchSongs } from './utils/search';
import { searchAlbums, fetchAlbumDetail } from './utils/album';
import { searchArtists, fetchArtistDetail } from './utils/artist';
import { searchPlaylists, fetchPlaylistDetail } from './utils/playlist';
import { getDownloadedIds } from './utils/history';
import type { DownloadedIds } from './utils/history';

// ─── Constants ────────────────────────────────────────────────────────────────

const SONG_API = 'https://sda.rhythmax.workers.dev';
// Defalut API (sda.rhythmax.workers.dev). Replace with your saavn-dl-api instance.
// Visit https://github.com/ODSkyler/saavn-dl-api for more information.

// ─── Top-level section ────────────────────────────────────────────────────────

type Section = 'search' | 'discover' | 'library' | 'playlists' | 'history';

// ─── Search tab ───────────────────────────────────────────────────────────────

type SearchTab = 'songs' | 'albums' | 'artists' | 'playlists';

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
  // ── Artist flows ──
  | { type: 'searching-artists'; query: string }
  | { type: 'artist-results'; results: ArtistSearchResult[]; query: string }
  | { type: 'fetching-artist-detail'; results: ArtistSearchResult[]; query: string; fetchingId: string }
  | { type: 'artist'; artist: ArtistDetail; fromSearch: boolean }
  // ── Playlist flows ──
  | { type: 'searching-playlists'; query: string }
  | { type: 'playlist-results'; results: PlaylistSearchResult[]; query: string }
  | { type: 'fetching-playlist-detail'; results: PlaylistSearchResult[]; query: string; fetchingId: string }
  | { type: 'playlist'; playlist: PlaylistDetail; fromSearch: boolean }
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
  const [view, setView] = useState<View>({ type: 'idle' });
  const [section, setSection] = useState<Section>('search');
  const [searchTab, setSearchTab] = useState<SearchTab>('songs');
  const [searchError, setSearchError] = useState('');
  const [searchBarKey, setSearchBarKey] = useState(0);
  const [showUpdates, setShowUpdates] = useState(false);
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [musicPathEnabled, setMusicPathEnabled] = useState(false);
  const [playlistsEnabled, setPlaylistsEnabled] = useState(false);
  const [downloadedIds, setDownloadedIds] = useState<DownloadedIds>({ tracks: [], albums: [] });
  const lastSongSearch = useRef<{ results: SearchResult[]; query: string } | null>(null);
  const lastAlbumSearch = useRef<{ results: AlbumSearchResult[]; query: string } | null>(null);
  const lastArtistSearch = useRef<{ results: ArtistSearchResult[]; query: string } | null>(null);
  const lastPlaylistSearch = useRef<{ results: PlaylistSearchResult[]; query: string } | null>(null);

  useEffect(() => {
    fetch('/updates.json').then(r => r.json()).then(setUpdates).catch(() => { });
  }, []);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => {
      if (data.musicPathEnabled) setMusicPathEnabled(true);
      if (data.playlistsEnabled) setPlaylistsEnabled(true);
    }).catch(() => { });
  }, []);

  // Load downloaded IDs for "already downloaded" badges
  useEffect(() => {
    getDownloadedIds().then(setDownloadedIds).catch(() => { });
  }, [view.type]);

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
    } else if (searchTab === 'albums') {
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
    } else if (searchTab === 'artists') {
      setView({ type: 'searching-artists', query });
      try {
        const results = await searchArtists(query);
        lastArtistSearch.current = { results, query };
        setView({ type: 'artist-results', results, query });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Artist search failed';
        setSearchError(msg);
        setView({ type: 'error', message: msg, context: 'search' });
      }
    } else {
      setView({ type: 'searching-playlists', query });
      try {
        const results = await searchPlaylists(query);
        lastPlaylistSearch.current = { results, query };
        setView({ type: 'playlist-results', results, query });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Playlist search failed';
        setSearchError(msg);
        setView({ type: 'error', message: msg, context: 'search' });
      }
    }
  }, [searchTab]);

  // ── Song result select → re-fetch full song ───────────────────────────────

  const handleSongResultSelect = useCallback(async (result: SearchResult) => {
    const currentResults = view.type === 'song-results' || view.type === 'fetching-song-result' ? view.results : [];
    const currentQuery = view.type === 'song-results' || view.type === 'fetching-song-result' ? view.query : '';
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
    const currentQuery = view.type === 'album-results' || view.type === 'fetching-album-result' ? view.query : '';
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

  // ── Artist result select → fetch artist detail ────────────────────────────

  const handleArtistResultSelect = useCallback(async (result: ArtistSearchResult) => {
    const currentResults = view.type === 'artist-results' || view.type === 'fetching-artist-detail' ? view.results : [];
    const currentQuery = view.type === 'artist-results' || view.type === 'fetching-artist-detail' ? view.query : '';
    setView({ type: 'fetching-artist-detail', results: currentResults, query: currentQuery, fetchingId: result.id });
    setSearchError('');
    try {
      const artist = await fetchArtistDetail(result.id);
      setView({ type: 'artist', artist, fromSearch: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load artist';
      setSearchError(msg);
      setView({ type: 'artist-results', results: currentResults, query: currentQuery });
    }
  }, [view]);

  // ── Playlist result select → fetch playlist detail ────────────────────────

  const handlePlaylistResultSelect = useCallback(async (result: PlaylistSearchResult) => {
    const currentResults = view.type === 'playlist-results' || view.type === 'fetching-playlist-detail' ? view.results : [];
    const currentQuery = view.type === 'playlist-results' || view.type === 'fetching-playlist-detail' ? view.query : '';
    setView({ type: 'fetching-playlist-detail', results: currentResults, query: currentQuery, fetchingId: result.id });
    setSearchError('');
    try {
      const playlist = await fetchPlaylistDetail(result.token || result.id);
      setView({ type: 'playlist', playlist, fromSearch: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load playlist';
      setSearchError(msg);
      setView({ type: 'playlist-results', results: currentResults, query: currentQuery });
    }
  }, [view]);

  // ── Artist page → album select → fetch album detail ───────────────────────

  const handleArtistAlbumSelect = useCallback(async (albumUrl: string) => {
    setView({ type: 'fetching-album' });
    setSearchError('');
    try {
      const album = await fetchAlbumDetail(albumUrl);
      setView({ type: 'album', album, fromSearch: true });
    } catch (err) {
      setView({ type: 'error', message: err instanceof Error ? err.message : 'Album fetch failed', context: 'url' });
    }
  }, []);

  // ── Back to results ───────────────────────────────────────────────────────

  const goBack = () => {
    setSearchError('');
    if (view.type === 'track' && view.fromSearch && lastSongSearch.current) {
      setView({ type: 'song-results', ...lastSongSearch.current });
    } else if (view.type === 'album' && view.fromSearch && lastAlbumSearch.current) {
      setView({ type: 'album-results', ...lastAlbumSearch.current });
    } else if (view.type === 'album' && view.fromSearch && lastArtistSearch.current) {
      // If we came from artist page → album, try going back to artist results
      setView({ type: 'artist-results', ...lastArtistSearch.current });
    } else if (view.type === 'artist' && view.fromSearch && lastArtistSearch.current) {
      setView({ type: 'artist-results', ...lastArtistSearch.current });
    } else if (view.type === 'playlist' && view.fromSearch && lastPlaylistSearch.current) {
      setView({ type: 'playlist-results', ...lastPlaylistSearch.current });
    } else {
      setView({ type: 'idle' });
    }
  };

  // ── Go home ────────────────────────────────────────────────────────────────

  const goHome = () => {
    setSection('search');
    setView({ type: 'idle' });
    setSearchError('');
    setSearchBarKey((k) => k + 1);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isFetchingUrl = view.type === 'fetching-song' || view.type === 'fetching-album';
  const isSearching = view.type === 'searching-songs' || view.type === 'searching-albums' || view.type === 'searching-artists' || view.type === 'searching-playlists';
  const isFetchingResult = view.type === 'fetching-song-result' || view.type === 'fetching-album-result' || view.type === 'fetching-artist-detail' || view.type === 'fetching-playlist-detail';
  const isAnyLoading = isFetchingUrl || isSearching || isFetchingResult;
  const showSongResults = ['searching-songs', 'song-results', 'fetching-song-result'].includes(view.type) || (view.type === 'error' && view.context === 'search' && searchTab === 'songs');
  const showAlbumResults = ['searching-albums', 'album-results', 'fetching-album-result'].includes(view.type) || (view.type === 'error' && view.context === 'search' && searchTab === 'albums');
  const showArtistResults = ['searching-artists', 'artist-results', 'fetching-artist-detail'].includes(view.type) || (view.type === 'error' && view.context === 'search' && searchTab === 'artists');
  const showPlaylistResults = ['searching-playlists', 'playlist-results', 'fetching-playlist-detail'].includes(view.type) || (view.type === 'error' && view.context === 'search' && searchTab === 'playlists');
  const showSearch = showSongResults || showAlbumResults || showArtistResults || showPlaylistResults;

  // Memoize downloaded ID sets for badge checks
  const downloadedTrackIds = new Set(downloadedIds.tracks);
  const downloadedAlbumIds = new Set(downloadedIds.albums);

  return (
    <DownloadPrefsProvider>
      <DownloadQueueProvider>
        <div className="min-h-screen bg-void relative overflow-x-hidden">
          {/* Download indicator (top-right) */}
          <DownloadIndicator onClick={() => setShowDownloadPanel(true)} />
          {/* Download manager panel */}
          <DownloadManagerPanel isOpen={showDownloadPanel} onClose={() => setShowDownloadPanel(false)} />
          {/* Ambient bg */}
          <div className="fixed inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-mesh-cyan" />
            <div className="absolute inset-0 bg-mesh-rose" />
            <div className="absolute inset-0 opacity-[0.012]" style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)',
              backgroundSize: '40px 40px',
            }} />
          </div>

          <div className="relative z-10 flex flex-col items-center min-h-screen px-4 py-8 sm:py-12">

            {/* Header row — title left, icons right */}
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="w-full max-w-2xl mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1
                    onClick={goHome}
                    className="text-2xl font-display font-bold text-text-primary tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    saavn<span className="text-cyan">-dl</span>
                  </h1>
                  <p className="text-[12px] text-white/50 font-body mt-0.5">
                    Download from JioSaavn · up to <span className="text-cyan font-mono">320 kbps</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a href="https://github.com/mukeshmk/saavn-dl" target="_blank" rel="noopener noreferrer"
                    className="w-8 h-8 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-white hover:border-white/20 hover:bg-white/5 transition-all duration-200" aria-label="GitHub">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.866-.013-1.699-2.782.605-3.37-1.343-3.37-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.523 2 12 2z" />
                    </svg>
                  </a>
                  <button onClick={() => setShowUpdates(true)}
                    className="w-8 h-8 rounded-full bg-glass border border-border flex items-center justify-center text-text-muted hover:text-cyan hover:border-cyan/30 hover:bg-cyan/10 transition-all duration-200" aria-label="Updates">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Top-level navigation — desktop pill / mobile bottom bar */}
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }} className="w-full max-w-2xl mb-0 sm:mb-6">
              <PrimaryNav
                sections={(() => {
                  const s: Section[] = ['search', 'discover'];
                  if (musicPathEnabled) s.push('library');
                  if (playlistsEnabled) s.push('playlists');
                  s.push('history');
                  return s;
                })()}
                active={section}
                onSelect={(s) => setSection(s as Section)}
              />
            </motion.div>

            {/* Search bar — only when search section is active */}
            {section === 'search' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="w-full max-w-2xl">
                <SearchBar
                  key={searchBarKey}
                  onUrlFetch={handleUrlFetch}
                  onAlbumFetch={handleAlbumFetch}
                  onSearch={handleSearch}
                  isLoading={isAnyLoading}
                />
              </motion.div>
            )}

            {/* Search type sub-tabs — only when search section is active and relevant */}
            {section === 'search' && (
              <AnimatePresence>
                {(showSearch || view.type === 'idle') && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="w-full max-w-2xl mt-4 flex gap-1"
                  >
                    {(['songs', 'albums', 'artists'] as SearchTab[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setSearchTab(tab)}
                        className={`px-4 py-1.5 rounded-lg text-[12px] font-display font-semibold capitalize transition-all duration-150 ${searchTab === tab
                          ? 'bg-cyan/10 border border-cyan/30 text-cyan'
                          : 'border border-transparent text-text-muted hover:text-text-secondary hover:border-border'
                          }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            )}

            {/* Content area */}
            <div className="w-full max-w-2xl mt-5">

              {/* ─── Search section content ─── */}
              {section === 'search' && (
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
                      <TrackCard song={view.song} />
                    </motion.div>
                  )}

                  {/* Album page */}
                  {view.type === 'album' && (
                    <motion.div key={`album-${view.album.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <AlbumPage album={view.album} onBack={view.fromSearch ? goBack : undefined} downloadedTrackIds={downloadedTrackIds} />
                    </motion.div>
                  )}

                  {/* Artist page */}
                  {view.type === 'artist' && (
                    <motion.div key={`artist-${view.artist.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <ArtistPage artist={view.artist} onBack={view.fromSearch ? goBack : undefined} onAlbumSelect={handleArtistAlbumSelect} />
                    </motion.div>
                  )}

                  {/* Playlist page */}
                  {view.type === 'playlist' && (
                    <motion.div key={`playlist-${view.playlist.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <PlaylistPage playlist={view.playlist} onBack={view.fromSearch ? goBack : undefined} downloadedTrackIds={downloadedTrackIds} />
                    </motion.div>
                  )}

                  {/* Song search results */}
                  {showSongResults && (
                    <motion.div key="song-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <SearchErrorBanner error={searchError} />
                      <SearchResults
                        results={view.type === 'song-results' || view.type === 'fetching-song-result' ? view.results : []}
                        query={
                          view.type === 'searching-songs' ? view.query
                            : view.type === 'song-results' ? view.query
                              : view.type === 'fetching-song-result' ? view.query
                                : ''
                        }
                        isSearching={view.type === 'searching-songs'}
                        fetchingId={view.type === 'fetching-song-result' ? view.fetchingId : null}
                        onSelect={handleSongResultSelect}
                        error={view.type === 'error' && view.context === 'search' ? view.message : ''}
                        downloadedTrackIds={downloadedTrackIds}
                      />
                    </motion.div>
                  )}

                  {/* Album search results */}
                  {showAlbumResults && (
                    <motion.div key="album-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <SearchErrorBanner error={searchError} />
                      <AlbumResultsPanel
                        view={view}
                        onSelect={handleAlbumResultSelect}
                        downloadedAlbumIds={downloadedAlbumIds}
                      />
                    </motion.div>
                  )}

                  {/* Artist search results */}
                  {showArtistResults && (
                    <motion.div key="artist-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <SearchErrorBanner error={searchError} />
                      <ArtistResultsPanel
                        view={view}
                        onSelect={handleArtistResultSelect}
                      />
                    </motion.div>
                  )}

                  {/* Playlist search results */}
                  {showPlaylistResults && (
                    <motion.div key="playlist-search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <SearchErrorBanner error={searchError} />
                      <PlaylistResultsPanel
                        view={view}
                        onSelect={handlePlaylistResultSelect}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}

              {/* ─── Discover section ─── */}
              {section === 'discover' && (
                <DiscoverPage
                  onPlaylistSelect={(playlist) => {
                    setSection('search');
                    setView({ type: 'playlist', playlist, fromSearch: false });
                  }}
                  onAlbumSelect={(album) => {
                    setSection('search');
                    setView({ type: 'album', album, fromSearch: false });
                  }}
                  onSongSelect={(song) => {
                    setSection('search');
                    setView({ type: 'track', song, fromSearch: false });
                  }}
                  downloadedAlbumIds={downloadedAlbumIds}
                  downloadedTrackIds={downloadedTrackIds}
                />
              )}

              {/* ─── Library section ─── */}
              {section === 'library' && <LibraryPage />}

              {/* ─── Playlists section ─── */}
              {section === 'playlists' && <PlaylistsPage musicPathEnabled={musicPathEnabled} />}

              {/* ─── History section ─── */}
              {section === 'history' && <HistoryPage />}

            </div>

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

            {/* Spacer so scrolled content clears the fixed mobile bottom bar */}
            <div aria-hidden className="h-20 sm:hidden" />

          </div>
        </div>
      </DownloadQueueProvider>
    </DownloadPrefsProvider>
  );
}

// ─── Album results panel ──────────────────────────────────────────────────────

function AlbumResultsPanel({
  view,
  onSelect,
  downloadedAlbumIds,
}: {
  view: View;
  onSelect: (r: AlbumSearchResult) => void;
  downloadedAlbumIds?: Set<string>;
}) {
  const isSearching = view.type === 'searching-albums';
  const results = view.type === 'album-results' || view.type === 'fetching-album-result' ? view.results : [];
  const query = view.type === 'searching-albums' ? view.query : view.type === 'album-results' || view.type === 'fetching-album-result' ? view.query : '';
  const fetchingId = view.type === 'fetching-album-result' ? view.fetchingId : null;
  const isFetching = fetchingId !== null;
  const error = view.type === 'error' && view.context === 'search' ? view.message : '';

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
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
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
            isDownloaded={downloadedAlbumIds?.has(album.id)}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Artist results panel ─────────────────────────────────────────────────────

function ArtistResultsPanel({
  view,
  onSelect,
}: {
  view: View;
  onSelect: (r: ArtistSearchResult) => void;
}) {
  const isSearching = view.type === 'searching-artists';
  const results = view.type === 'artist-results' || view.type === 'fetching-artist-detail' ? view.results : [];
  const query = view.type === 'searching-artists' ? view.query : view.type === 'artist-results' || view.type === 'fetching-artist-detail' ? view.query : '';
  const fetchingId = view.type === 'fetching-artist-detail' ? view.fetchingId : null;
  const isFetching = fetchingId !== null;
  const error = view.type === 'error' && view.context === 'search' ? view.message : '';

  const shimmer = { background: 'linear-gradient(90deg,#1e1e28 0%,#2a2a38 50%,#1e1e28 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.8s ease-in-out infinite' };

  if (isSearching) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-[11px] font-mono text-violet-400 truncate">Searching artists for "{query}"…</span>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.055 }}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-glass">
            <div className="w-12 h-12 rounded-full flex-shrink-0" style={shimmer} />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 rounded w-2/5" style={shimmer} />
              <div className="h-3 rounded w-1/5" style={shimmer} />
            </div>
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
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <p className="text-sm font-display font-semibold text-rose">Artist search failed</p>
          <p className="text-xs font-mono text-rose/70 mt-0.5">{error}</p>
        </div>
      </motion.div>
    );
  }

  if (!results.length && query) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-12">
        <p className="text-3xl mb-3">🎤</p>
        <p className="text-sm font-display font-semibold text-text-secondary">No artists found for "{query}"</p>
        <p className="text-xs font-mono text-text-muted mt-1.5">Try different keywords</p>
      </motion.div>
    );
  }

  if (!results.length) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider flex-shrink-0">Artists for</span>
          <span className="text-[11px] font-mono text-cyan truncate">"{query}"</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFetching && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[11px] font-mono text-violet-400/70 flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
              Loading…
            </motion.span>
          )}
          <span className="text-[11px] font-mono text-text-muted">{results.length} artists</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {results.map((artist, i) => (
          <ArtistResultCard
            key={artist.id}
            artist={artist}
            index={i}
            onSelect={onSelect}
            isLoading={fetchingId === artist.id}
            anyLoading={isFetching}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Playlist results panel ───────────────────────────────────────────────────

function PlaylistResultsPanel({
  view,
  onSelect,
}: {
  view: View;
  onSelect: (r: PlaylistSearchResult) => void;
}) {
  const isSearching = view.type === 'searching-playlists';
  const results = view.type === 'playlist-results' || view.type === 'fetching-playlist-detail' ? view.results : [];
  const query = view.type === 'searching-playlists' ? view.query : view.type === 'playlist-results' || view.type === 'fetching-playlist-detail' ? view.query : '';
  const fetchingId = view.type === 'fetching-playlist-detail' ? view.fetchingId : null;
  const isFetching = fetchingId !== null;
  const error = view.type === 'error' && view.context === 'search' ? view.message : '';

  const shimmer = { background: 'linear-gradient(90deg,#1e1e28 0%,#2a2a38 50%,#1e1e28 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.8s ease-in-out infinite' };

  if (isSearching) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-[11px] font-mono text-violet-400 truncate">Searching playlists for "{query}"…</span>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.055 }}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-glass">
            <div className="w-12 h-12 rounded-lg flex-shrink-0" style={shimmer} />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 rounded w-3/5" style={shimmer} />
              <div className="h-3 rounded w-2/5" style={shimmer} />
            </div>
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
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <p className="text-sm font-display font-semibold text-rose">Playlist search failed</p>
          <p className="text-xs font-mono text-rose/70 mt-0.5">{error}</p>
        </div>
      </motion.div>
    );
  }

  if (!results.length && query) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-12">
        <p className="text-3xl mb-3">🎶</p>
        <p className="text-sm font-display font-semibold text-text-secondary">No playlists found for "{query}"</p>
        <p className="text-xs font-mono text-text-muted mt-1.5">Try different keywords</p>
      </motion.div>
    );
  }

  if (!results.length) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider flex-shrink-0">Playlists for</span>
          <span className="text-[11px] font-mono text-cyan truncate">"{query}"</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFetching && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[11px] font-mono text-violet-400/70 flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />
              Loading…
            </motion.span>
          )}
          <span className="text-[11px] font-mono text-text-muted">{results.length} playlists</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {results.map((playlist, i) => (
          <PlaylistResultCard
            key={playlist.id}
            playlist={playlist}
            index={i}
            onSelect={onSelect}
            isLoading={fetchingId === playlist.id}
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
        className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6" /></svg>
      {label}
    </motion.button>
  );
}

function SearchErrorBanner({ error }: { error: string }) {
  if (!error) return null;
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-rose/20 bg-rose/5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2" className="flex-shrink-0">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-[11px] font-mono text-rose/80">{error}</p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function FetchError({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="rounded-2xl border border-rose/20 bg-rose/5 p-5 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-rose/10 border border-rose/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b8a" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-display font-semibold text-rose">Failed to fetch</p>
        <p className="text-xs font-mono text-rose/70 mt-0.5">{message}</p>
      </div>
    </motion.div>
  );
}
