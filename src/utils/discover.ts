/**
 * Discover utility — fetches home feed, new releases, related albums,
 * and trending data from the JioSaavn API.
 */

import { proxyFetch } from './proxy';

const API_BASE = 'https://rthmx.vercel.app/api';
// Default API (rthmx.vercel.app). Replace with your jiosaavn-api instance.
// Visit https://github.com/ODSkyler/jiosaavn-api for more information.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoverAlbum {
  id: string;
  token?: string;
  title: string;
  subtitle?: string;
  type: string;
  perma_url?: string;
  album_url?: string;
  url?: string;
  image: string;
  language?: string;
  year?: string;
  isExplicit?: boolean;
  song_count?: string;
  artists?: {
    primary: { id: string; name: string; image?: string }[];
    featured: { id: string; name: string; image?: string }[];
  };
}

export interface DiscoverPlaylist {
  id: string;
  token?: string;
  title: string;
  subtitle?: string;
  type: string;
  image: string;
  perma_url?: string;
  url?: string;
  more_info?: {
    firstname?: string;
    song_count?: string;
    language?: string;
  };
}

export interface HomeFeedSection {
  title: string;
  type: 'album' | 'playlist' | 'mixed';
  items: (DiscoverAlbum | DiscoverPlaylist)[];
}

export interface DiscoverData {
  trending: HomeFeedSection[];
  newReleases: DiscoverAlbum[];
}

// ─── API Calls ────────────────────────────────────────────────────────────────

/**
 * Fetch the JioSaavn home feed. Returns trending playlists, charts, etc.
 * Optionally filtered by language(s).
 */
export async function fetchHomeFeed(languages?: string[]): Promise<HomeFeedSection[]> {
  const lang = languages?.join(',') || 'english';
  const res = await proxyFetch(`${API_BASE}/home?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) throw new Error(`Home feed failed: HTTP ${res.status}`);
  const data = await res.json();

  const sections: HomeFeedSection[] = [];

  // The API returns { modules: [{ id, title, position, items: [...] }] }
  const modules = Array.isArray(data?.modules) ? data.modules : [];

  for (const mod of modules) {
    if (!mod?.title || !Array.isArray(mod.items) || mod.items.length === 0) continue;

    const items = mod.items.filter((item: any) => item?.id && item?.title);
    if (items.length === 0) continue;

    const type = items[0]?.type === 'playlist' ? 'playlist' : items[0]?.type === 'album' ? 'album' : 'mixed';
    sections.push({ title: mod.title, type, items });
  }

  return sections;
}

/**
 * Fetch new releases by language.
 */
export async function fetchNewReleases(languages?: string[]): Promise<DiscoverAlbum[]> {
  const lang = languages?.join(',') || 'english';
  const res = await proxyFetch(`${API_BASE}/new?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) throw new Error(`New releases failed: HTTP ${res.status}`);
  const data = await res.json();

  // Normalize response — may be array or { results: [...] }
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.albums)
        ? data.albums
        : [];

  return items.filter((item: any) => item?.id && item?.title);
}

/**
 * Fetch related albums given an album ID.
 */
export async function fetchRelatedAlbums(albumId: string): Promise<DiscoverAlbum[]> {
  if (!albumId) return [];
  const res = await proxyFetch(`${API_BASE}/related?id=${encodeURIComponent(albumId)}`);
  if (!res.ok) return []; // Non-critical, fail silently
  const data = await res.json();

  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : [];

  return items.filter((item: any) => item?.id && item?.title);
}

/**
 * Fetch artist details to get their curated playlists.
 * Returns dedicated_artist_playlist and featured_artist_playlist.
 */
export async function fetchArtistPlaylists(artistToken: string): Promise<DiscoverPlaylist[]> {
  if (!artistToken) return [];
  const res = await proxyFetch(`${API_BASE}/artist?token=${encodeURIComponent(artistToken)}&page=0`);
  if (!res.ok) return [];
  const data = await res.json();

  const playlists: DiscoverPlaylist[] = [];

  if (Array.isArray(data?.dedicated_artist_playlist)) {
    playlists.push(...data.dedicated_artist_playlist);
  }
  if (Array.isArray(data?.featured_artist_playlist)) {
    playlists.push(...data.featured_artist_playlist);
  }

  return playlists.filter((p: any) => p?.id && p?.title);
}



// ─── History-based personalization ────────────────────────────────────────────

import type { HistoryEntry } from './history';
import { getHistory } from './history';

export interface PersonalizationData {
  languages: string[];
  lastAlbumId: string | undefined;
  frequentArtistTokens: string[];
}

/**
 * Extracts personalization hints from download history.
 * Returns detected languages, last album ID, and frequent artists.
 */
export async function getPersonalizationData(): Promise<PersonalizationData> {
  try {
    const { entries } = await getHistory({ limit: 50 });

    // Extract languages (most common first)
    const langCounts = new Map<string, number>();
    for (const entry of entries) {
      const lang = entry.language?.toLowerCase().trim();
      if (lang) {
        langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
      }
    }
    const languages = [...langCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang)
      .slice(0, 3);

    // Get last downloaded album's saavnId
    const lastAlbum = entries.find((e) => e.type === 'album');
    const lastAlbumId = lastAlbum?.saavnId;

    // Get most frequent artists (from history entries)
    // Note: we don't have artist tokens in history, just names.
    // We'll store this as empty for now — artist personalization
    // requires an artist search which adds latency.
    const frequentArtistTokens: string[] = [];

    return { languages, lastAlbumId, frequentArtistTokens };
  } catch {
    return { languages: [], lastAlbumId: undefined, frequentArtistTokens: [] };
  }
}
