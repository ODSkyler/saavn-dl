import type { ArtistSearchResult, ArtistDetail } from '../types/saavn';
import { proxyFetch } from './proxy';

const SEARCH_API = 'https://rthmx.vercel.app/api/artists';
// Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.
const DETAIL_API = 'https://rthmx.vercel.app/api/artist';
// Defalut API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.

interface ArtistSearchApiResponse {
  total: number;
  start: number;
  results: Array<{
    name: string;
    id: string;
    token: string;
    image: string;
    perma_url: string;
    type: string;
  }>;
}

export async function searchArtists(query: string): Promise<ArtistSearchResult[]> {
  if (!query.trim()) return [];
  const res = await proxyFetch(`${SEARCH_API}?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error(`Artist search failed: HTTP ${res.status}`);
  const data: ArtistSearchApiResponse = await res.json();

  const results = Array.isArray(data?.results) ? data.results : [];

  return results.map((r) => ({
    id: r.token || r.id,
    name: r.name,
    image: r.image || '',
    type: 'artist' as const,
    perma_url: r.perma_url || '',
  }));
}

export async function fetchArtistDetail(token: string, page = 0): Promise<ArtistDetail> {
  const res = await proxyFetch(`${DETAIL_API}?token=${encodeURIComponent(token)}&page=${page}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Artist fetch failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data?.id && !data?.name) {
    throw new Error('Invalid artist response — missing id or name');
  }
  return {
    id: data.id || token,
    name: data.name || 'Unknown Artist',
    subtitle: data.subtitle || '',
    image: data.image || '',
    topAlbums: Array.isArray(data.topAlbums) ? data.topAlbums : [],
    singles: Array.isArray(data.singles) ? data.singles : [],
    latest_release: Array.isArray(data.latest_release) ? data.latest_release : [],
  };
}
