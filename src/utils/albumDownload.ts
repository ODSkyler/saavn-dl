import JSZip from 'jszip';
import type { SaavnSong, AlbumDetail } from '../types/saavn';
import { sanitizeFilename } from './decrypt';
import { getFFmpeg } from './download';
import { decryptMediaUrl, getQualityUrl } from './decrypt';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlbumDownloadMode = 'individual' | 'zip';

export interface TrackStatus {
  id: string;
  title: string;
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'skipped';
  error?: string;
  blob?: Blob;
}

export interface AlbumDownloadProgress {
  current: number;
  total: number;
  currentTitle: string;
  stage: string;
  percent: number;
  tracks: TrackStatus[];
  zipStage?: 'compressing' | 'preparing' | 'done';
}

export type ProgressCallback = (p: AlbumDownloadProgress) => void;
export type FailureCallback = (
  trackIndex: number,
  track: SaavnSong,
  error: string,
) => Promise<'skip' | 'retry'>;

// ─── Size estimation ──────────────────────────────────────────────────────────

const KBPS_TO_BYTES_PER_SEC: Record<string, number> = {
  '12':  1_500,
  '48':  6_000,
  '96':  12_000,
  '160': 20_000,
  '320': 40_000,
};

export function estimateAlbumSizeMB(songs: SaavnSong[], quality: string): number {
  const bps = KBPS_TO_BYTES_PER_SEC[quality] ?? 40_000;
  const totalSec = songs.reduce(
    (acc, s) => acc + parseInt(s.more_info?.duration || '0', 10),
    0,
  );
  return (totalSec * bps) / (1024 * 1024);
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ─── Internal ffmpeg helpers (per-track; avoid circular imports) ──────────────

function withTimeoutT<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

async function safeDeleteT(ff: FFmpeg, files: string[]): Promise<void> {
  for (const f of files) {
    try { await ff.deleteFile(f); } catch { /* ok */ }
  }
}

function validateT(data: Uint8Array | string, label: string): Uint8Array {
  if (typeof data === 'string') throw new Error(`${label}: string output`);
  if (data.byteLength < 1024)  throw new Error(`${label}: output too small (${data.byteLength}B)`);
  return data;
}

function getArtistT(song: SaavnSong): string {
  return (
    song.subtitle?.split(' - ')[0]?.trim() ||
    song.more_info.artists?.primary?.[0]?.name ||
    'Unknown Artist'
  );
}

function getImageUrlT(song: SaavnSong): string {
  return song.image.replace(/\d+x\d+/, '500x500').replace('http://', 'https://');
}

/**
 * Download a single track and return it as a Blob (no browser download triggered).
 * Reuses the same ffmpeg singleton and embed strategies as `downloadWithMetadata`.
 */
async function trackToBlob(
  song: SaavnSong,
  quality: string,
  onProgress: (stage: string, pct: number) => void,
): Promise<Blob> {
  const { more_info } = song;

  onProgress('Decrypting…', 8);

const encryptedMediaUrl =
  song.encrypted_media_url || more_info?.encrypted_media_url;

if (!encryptedMediaUrl) {
  throw new Error('Missing encrypted media URL');
}

const decrypted = decryptMediaUrl(encryptedMediaUrl);
  const audioUrl  = getQualityUrl(decrypted, quality);

  onProgress('Fetching audio…', 20);
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
  const audioBlob = await audioResp.blob();
  if (audioBlob.size < 1024) throw new Error('Audio response is empty — URL may have expired');

  onProgress('Fetching cover…', 35);
  let coverData: Uint8Array | null = null;
  try {
    const imgResp = await fetch(getImageUrlT(song));
    if (imgResp.ok) {
      const imgBlob = await imgResp.blob();
      if (imgBlob.size > 500) coverData = new Uint8Array(await imgBlob.arrayBuffer());
    }
  } catch { /* cover is optional */ }

  onProgress('Loading ffmpeg…', 50);
  const ff = await getFFmpeg();

  const audioData = new Uint8Array(await audioBlob.arrayBuffer());
  const artist    = getArtistT(song);
  const meta      = { title: song.title, artist, album: more_info.album, year: song.year };

  // Use song-id-scoped filenames so sequential calls don't collide inside wasm fs
  const inF  = `in_${song.id}.mp4`;
  const outF = `out_${song.id}.mp4`;
  const covF = `cov_${song.id}.jpg`;

  await ff.writeFile(inF, audioData);

  let outputData: Uint8Array;

  if (coverData) {
    onProgress('Embedding cover + metadata…', 65);
    await ff.writeFile(covF, coverData);

    const args = [
      '-i', inF, '-i', covF,
      '-map', '0:a:0', '-map', '1:v:0',
      '-c:a', 'copy', '-c:v', 'copy',
      '-disposition:v:0', 'attached_pic',
      '-metadata', `title=${meta.title}`,
      '-metadata', `artist=${meta.artist}`,
      '-metadata', `album=${meta.album}`,
      '-metadata', `date=${meta.year}`,
      '-metadata', 'comment=Downloaded via saavn-dl / Rhythmax',
      '-movflags', '+faststart',
      outF,
    ];

    try {
      await withTimeoutT(ff.exec(args), 90_000, 'embed+cover');
      const raw = await ff.readFile(outF) as Uint8Array;
      await safeDeleteT(ff, [inF, covF, outF]);
      outputData = validateT(raw, outF);
    } catch (err) {
      console.warn('[album-dl] Cover embed failed, retrying without cover:', err);
      onProgress('Retrying without cover…', 72);
      await safeDeleteT(ff, [covF, outF]);
      // meta-only fallback
      const metaArgs = [
        '-i', inF, '-c', 'copy',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.artist}`,
        '-metadata', `album=${meta.album}`,
        '-metadata', `date=${meta.year}`,
        '-metadata', 'comment=Downloaded via saavn-dl / Rhythmax',
        '-movflags', '+faststart',
        outF,
      ];
      await withTimeoutT(ff.exec(metaArgs), 45_000, 'meta-only');
      const raw = await ff.readFile(outF) as Uint8Array;
      await safeDeleteT(ff, [inF, outF]);
      outputData = validateT(raw, outF);
    }
  } else {
    onProgress('Embedding metadata…', 65);
    const metaArgs = [
      '-i', inF, '-c', 'copy',
      '-metadata', `title=${meta.title}`,
      '-metadata', `artist=${meta.artist}`,
      '-metadata', `album=${meta.album}`,
      '-metadata', `date=${meta.year}`,
      '-metadata', 'comment=Downloaded via saavn-dl / Rhythmax',
      '-movflags', '+faststart',
      outF,
    ];
    await withTimeoutT(ff.exec(metaArgs), 45_000, 'meta-only');
    const raw = await ff.readFile(outF) as Uint8Array;
    await safeDeleteT(ff, [inF, outF]);
    outputData = validateT(raw, outF);
  }

  onProgress('Done', 95);
  const buf = outputData.buffer.slice(
    outputData.byteOffset,
    outputData.byteOffset + outputData.byteLength,
  ) as ArrayBuffer;
  return new Blob([buf], { type: 'audio/mp4' });
}

// ─── Individual mode ──────────────────────────────────────────────────────────

export async function downloadAlbumIndividual(
  album: AlbumDetail,
  quality: string,
  onProgress: ProgressCallback,
  onFailure: FailureCallback,
): Promise<void> {
  const songs = album.songs;
  const tracks: TrackStatus[] = songs.map(s => ({ id: s.id, title: s.title, status: 'pending' as const }));

  const emit = (i: number, stage: string, pct: number) =>
    onProgress({ current: i + 1, total: songs.length, currentTitle: songs[i]?.title ?? '', stage, percent: pct, tracks: [...tracks] });

  for (let i = 0; i < songs.length; i++) {
    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 100));

    let attempt = 0;
    let resolved = false;

    while (!resolved && attempt < 2) {
      try {
        // Use downloadWithMetadata but wrapped to trigger individual file download
        const blob = await trackToBlob(songs[i], quality, (stage, p) => {
          tracks[i] = { ...tracks[i], status: 'downloading' };
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 100));
        });
        // Trigger individual download
        const artistName = getArtistT(songs[i]);
        const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(songs[i].title)} - ${sanitizeFilename(artistName)}.m4a`;
        triggerDownload(blob, filename);
        tracks[i] = { ...tracks[i], status: 'done' };
        resolved = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (attempt === 0) {
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
            resolved = true;
          } else {
            attempt++;
          }
        } else {
          // Second attempt also failed — ask again
          const action = await onFailure(i, songs[i], msg);
          if (action === 'skip') {
            tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
          } else {
            tracks[i] = { ...tracks[i], status: 'failed', error: msg };
          }
          resolved = true;
        }
      }
    }
  }

  onProgress({ current: songs.length, total: songs.length, currentTitle: '', stage: 'Done!', percent: 100, tracks: [...tracks] });
}

// ─── ZIP mode ─────────────────────────────────────────────────────────────────

export async function downloadAlbumZip(
  album: AlbumDetail,
  quality: string,
  onProgress: ProgressCallback,
  onFailure: FailureCallback,
): Promise<void> {
  const songs = album.songs;
  const tracks: TrackStatus[] = songs.map(s => ({ id: s.id, title: s.title, status: 'pending' as const }));
  const completed: Array<{ filename: string; blob: Blob }> = [];

  const emit = (i: number, stage: string, pct: number, zipStage?: AlbumDownloadProgress['zipStage']) =>
    onProgress({
      current: Math.min(i + 1, songs.length),
      total: songs.length,
      currentTitle: songs[Math.min(i, songs.length - 1)]?.title ?? '',
      stage,
      percent: pct,
      tracks: [...tracks],
      zipStage,
    });

  // ── Phase 1: download each track → blob ──────────────────────────────────

  for (let i = 0; i < songs.length; i++) {
    tracks[i] = { ...tracks[i], status: 'downloading' };
    emit(i, 'Starting…', Math.round((i / songs.length) * 88));

    let resolved = false;
    let attempt  = 0;

    while (!resolved && attempt < 2) {
      try {
        const blob = await trackToBlob(songs[i], quality, (stage, p) => {
          emit(i, stage, Math.round(((i + p / 100) / songs.length) * 88));
        });
        const artistName = getArtistT(songs[i]);
        const filename = `${String(i + 1).padStart(2, '0')} - ${sanitizeFilename(songs[i].title)} - ${sanitizeFilename(artistName)}.m4a`;
        completed.push({ filename, blob });
        tracks[i] = { ...tracks[i], status: 'done' };
        resolved = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        const action = await onFailure(i, songs[i], msg);
        if (action === 'skip') {
          tracks[i] = { ...tracks[i], status: 'skipped', error: msg };
          resolved = true;
        } else {
          attempt++;
          if (attempt >= 2) {
            tracks[i] = { ...tracks[i], status: 'failed', error: msg };
            resolved = true;
          }
        }
      }
    }
  }

  // ── Phase 2: build ZIP ────────────────────────────────────────────────────

  emit(songs.length - 1, 'Building ZIP…', 89, 'compressing');

  const zip    = new JSZip();
  const folder = zip.folder(sanitizeFilename(`${album.title} (${album.year})`))!;
  for (const { filename, blob } of completed) folder.file(filename, blob);

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => emit(songs.length - 1, `Compressing ${meta.percent.toFixed(0)}%…`, 89 + Math.round(meta.percent * 0.09), 'compressing'),
  );

  emit(songs.length - 1, 'Preparing download…', 99, 'preparing');

  // Release track blobs from memory
  completed.length = 0;

  const zipFilename = `${sanitizeFilename(album.title)} (${album.year}).zip`;
  triggerDownload(zipBlob, zipFilename);

  onProgress({
    current: songs.length,
    total: songs.length,
    currentTitle: '',
    stage: 'Done!',
    percent: 100,
    tracks: [...tracks],
    zipStage: 'done',
  });
}
