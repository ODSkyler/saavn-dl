export interface SaavnArtist {
  id: string;
  artist_token: string;
  name: string;
  image: string;
  perma_url: string;
}

export interface SaavnMoreInfo {
  album_id: string;
  album_token: string;
  album: string;
  label: string;
  album_url: string;
  encrypted_media_url: string;
  duration: string;
  copyright_text: string;
  artists: {
    primary: SaavnArtist[];
    featured: SaavnArtist[];
  };
  release_date: string;
  vcode: string;
  vlink: string;
}

export interface SaavnSong {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: string;
  perma_url: string;
  image: string;
  language: string;
  year: string;
  play_count: string;
  isExplicit: boolean;
  more_info: SaavnMoreInfo;
}

export type Quality = '12' | '48' | '96' | '160' | '320';

export interface QualityOption {
  value: Quality;
  label: string;
  tag?: string;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { value: '12', label: '12 kbps', tag: 'Very Low' },
  { value: '48', label: '48 kbps', tag: 'Low' },
  { value: '96', label: '96 kbps', tag: 'Normal' },
  { value: '160', label: '160 kbps', tag: 'High' },
  { value: '320', label: '320 kbps', tag: 'MAX' },
];

export interface SearchResult {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: string;
  perma_url: string;
  image: string;
  language?: string;
  year?: string;
  play_count?: string;
  isExplicit?: boolean;
  more_info?: {
    duration?: string;
    album?: string;
    encrypted_media_url?: string;
  };
}

export function extractArtistFromSubtitle(subtitle: string) {
  return subtitle?.split(' - ')[0]?.trim() || 'Unknown Artist';
}

export function formatDuration(sec?: string) {
  if (!sec) return '';

  const total = Number(sec);

  const mins = Math.floor(total / 60);
  const secs = total % 60;

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function searchImage(url: string) {
  if (!url) return "";

  const image50 = url.replace(
    /150x150|500x500/g,
    "50x50"
  );

  return `https://rthmx.vercel.app/api/image?url=${encodeURIComponent(image50)}`;
  // Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
  // Visit https://github.com/ODSkyler/jiosaavn-api for more information.
}

export function isSaavnUrl(value: string) {
  return /^https?:\/\/(www\.)?jiosaavn\.com\/.+/i.test(
    value.trim()
  );
}
// ─── Album types ──────────────────────────────────────────────────────────────

export interface AlbumArtist {
  id: string;
  artist_token?: string;
  name: string;
  image?: string;
  perma_url: string;
}

export interface AlbumSearchResult {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: 'album';
  perma_url: string;
  image: string;
  language: string;
  year: string;
  play_count: string;
  isExplicit: boolean;
  more_info: {
    song_count: string;
    artists: {
      primary: AlbumArtist[];
      featured: AlbumArtist[];
    };
  };
}

export interface AlbumDetail {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  header_desc: string;
  type: 'album';
  perma_url: string;
  image: string;
  language: string;
  year: string;
  song_count: string;
  isExplicit: boolean;
  copyright: string;
  artists: {
    primary: AlbumArtist[];
    featured: AlbumArtist[];
  };
  songs: SaavnSong[];
}

/** Image proxy — always goes through the Vercel proxy */
export function proxyImage(url: string, size: '50x50' | '150x150' | '500x500' = '150x150'): string {
  if (!url) return '';
  const sized = url.replace(/\d+x\d+/, size).replace('http://', 'https://');
  return `https://rthmx.vercel.app/api/image?url=${encodeURIComponent(sized)}`;
  // Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
  // Visit https://github.com/ODSkyler/jiosaavn-api for more information.
}

/** Alias: album 500x500 cover for the album page */
export function albumImage(url: string): string {
  return proxyImage(url, '500x500');
}

/** hiResImage used by search result cards */
export function hiResImage(url: string): string {
  return proxyImage(url, '150x150');
}

export function isSaavnAlbumUrl(value: string): boolean {
  return /jiosaavn\.com\/album\//i.test(value.trim());
}

/** Total duration from array of songs (in seconds) */
export function totalAlbumDuration(songs: SaavnSong[]): string {
  const total = songs.reduce((acc, s) => acc + parseInt(s.more_info?.duration || '0', 10), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// ─── Artist types ─────────────────────────────────────────────────────────────

export interface ArtistSearchResult {
  id: string;
  name: string;
  image: string;
  type: 'artist';
  perma_url: string;
}

export interface ArtistAlbum {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: string;
  perma_url: string;
  image: string;
  language: string;
  year: string;
  isExplicit: boolean;
  song_count: string;
  artists: {
    primary: AlbumArtist[];
    featured: AlbumArtist[];
  };
}

export interface ArtistDetail {
  id: string;
  name: string;
  subtitle: string;
  image: string;
  topAlbums: ArtistAlbum[];
  singles: ArtistAlbum[];
  latest_release: ArtistAlbum[];
}

export function isSaavnArtistUrl(value: string): boolean {
  return /jiosaavn\.com\/artist\//i.test(value.trim());
}

export function isSaavnPlaylistUrl(value: string): boolean {
  return /jiosaavn\.com\/(featured|s\/playlist)\//i.test(value.trim());
}

/** Extract artist token from a JioSaavn artist URL */
export function extractArtistToken(url: string): string {
  const parts = url.trim().replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || '';
}

// ─── Playlist types ───────────────────────────────────────────────────────────

export interface PlaylistSearchResult {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  type: 'playlist';
  image: string;
  perma_url: string;
  more_info: {
    firstname?: string;
    artist_name?: string[];
    entity_type?: string;
    song_count?: string;
    language?: string;
  };
}

export interface PlaylistDetail {
  id: string;
  token: string;
  title: string;
  subtitle: string;
  header_desc: string;
  type: 'playlist';
  perma_url: string;
  image: string;
  more_info: {
    firstname?: string;
    subtitle_desc?: string[];
  };
  list_count: string;
  songs: SaavnSong[];
}
