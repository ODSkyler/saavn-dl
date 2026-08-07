import type { PlaylistSearchResult, PlaylistDetail } from '../types/saavn';
import { proxyFetch } from './proxy';

const SEARCH_API = 'https://rthmx.vercel.app/api/playlists';
// Default API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.
const DETAIL_API = 'https://rthmx.vercel.app/api/playlist';
// Default API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.

export async function searchPlaylists(query: string): Promise<PlaylistSearchResult[]> {
  if (!query.trim()) return [];
  const res = await proxyFetch(`${SEARCH_API}?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error(`Playlist search failed: HTTP ${res.status}`);
  const data = await res.json();
  const arr: PlaylistSearchResult[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : [];
  return arr.filter((r) => r.type === 'playlist' || r.id);
}

/**
 * Extract playlist token from a JioSaavn playlist URL.
 * URLs look like: https://www.jiosaavn.com/featured/lets-play-the-weeknd/TDgTn0rFX18_
 * The token is the last path segment.
 */
export function extractPlaylistToken(url: string): string {
  const parts = url.trim().replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || '';
}

export async function fetchPlaylistDetail(tokenOrUrl: string): Promise<PlaylistDetail> {
  // If it looks like a URL, extract the token
  const token = tokenOrUrl.includes('/')
    ? extractPlaylistToken(tokenOrUrl)
    : tokenOrUrl;

  const res = await proxyFetch(`${DETAIL_API}?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Playlist fetch failed: HTTP ${res.status}`);
  }
  const data = await res.json();

  if (!data?.id) {
    throw new Error('Invalid playlist response — missing id');
  }

  // Normalize the response — the API returns songs in `list` array
  const songs = Array.isArray(data.list) ? data.list : Array.isArray(data.songs) ? data.songs : [];

  return {
    id: data.id,
    token: data.token || token,
    title: data.title || 'Unknown Playlist',
    subtitle: data.subtitle || '',
    header_desc: data.header_desc || '',
    type: 'playlist',
    perma_url: data.perma_url || '',
    image: data.image || '',
    more_info: data.more_info || {},
    list_count: data.list_count || String(songs.length),
    songs,
  };
}
