import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { SaavnSong } from '../types/saavn';
import { decryptMediaUrl, getQualityUrl, sanitizeFilename } from './decrypt';
import type { TrackMetadata } from '../types/metadata';

// ─── FFmpeg singleton ──────────────────────────────────────────────────────────

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    ffmpegInstance = new FFmpeg();

    // Mirror log to console for debugging
    ffmpegInstance.on('log', ({ message }) => {
      console.debug('[ffmpeg]', message);
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegLoaded = true;
    return ffmpegInstance;
  })();

  return loadPromise;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Race an async fn against a timeout; throws if timeout fires first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function getArtistTag(song: SaavnSong): string {
  const fromSubtitle = song.subtitle
    ?.split(' - ')[0]
    ?.trim();

  if (fromSubtitle) {
    return fromSubtitle;
  }

  const fromPrimary = song.more_info.artists?.primary
    ?.map((a) => a.name)
    .join(', ');

  return fromPrimary || 'Unknown Artist';
}

function getImageUrl(song: SaavnSong): string {
  return song.image
    .replace(/\d+x\d+/, '500x500')
    .replace('http://', 'https://');
}

function validateOutput(data: Uint8Array | string, label: string): Uint8Array {
  if (typeof data === 'string') throw new Error(`${label}: got string instead of bytes`);
  if (data.byteLength < 1024) throw new Error(`${label}: output too small (${data.byteLength} bytes) — likely empty`);
  return data;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Copy out of potential SharedArrayBuffer
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

async function safeDeleteFile(ff: FFmpeg, path: string): Promise<void> {
  try { await ff.deleteFile(path); } catch { /* ignore */ }
}

// ─── Core exec with output validation ─────────────────────────────────────────

/**
 * Run ffmpeg args, read output, validate size, clean up.
 * Throws if exec times out or output is suspiciously small.
 */
async function runFFmpeg(
  ff: FFmpeg,
  args: string[],
  inputFiles: string[],
  outputFile: string,
  timeoutMs = 60_000,
): Promise<Uint8Array> {
  try {
    await withTimeout(ff.exec(args), timeoutMs, 'ffmpeg exec');
  } catch (err) {
    // Clean up before re-throwing
    for (const f of [...inputFiles, outputFile]) await safeDeleteFile(ff, f);
    throw err;
  }

  const raw = await ff.readFile(outputFile) as Uint8Array;

  for (const f of [...inputFiles, outputFile]) await safeDeleteFile(ff, f);

  return validateOutput(raw, outputFile);
}

// ─── Strategy A: metadata + cover art ─────────────────────────────────────────

async function embedWithCover(
  ff: FFmpeg,
  audioData: Uint8Array,
  coverData: Uint8Array,
  meta: {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year: string;
  publisher: string;
  copyright: string;
},
): Promise<Uint8Array> {
  await ff.writeFile('in.mp4', audioData);
  await ff.writeFile('cover.jpg', coverData);

  // For MP4/M4A containers the safest cover-art embed is:
  // map audio from input 0, map video (cover) from input 1,
  // copy both streams, tag the video as attached_pic.
  // We avoid re-encoding (-c:v copy) because the cover is already JPEG.
  const args = [
    '-i', 'in.mp4',
    '-i', 'cover.jpg',
    '-map', '0:a:0',
    '-map', '1:v:0',
    '-c:a', 'copy',
    '-c:v', 'copy',
    '-disposition:v:0', 'attached_pic',
    '-metadata', `title=${meta.title}`,
    '-metadata', `artist=${meta.artist}`,
    '-metadata', `album=${meta.album}`,
    '-metadata', `date=${meta.year}`,
    '-metadata', `publisher=${meta.publisher}`,
    '-metadata', `copyright=${meta.copyright}`,
    '-metadata', 'comment=Downloaded via saavn-dl / Rhythmax',
    '-movflags', '+faststart',
    'out.mp4',
  ];

  // Cover embedding can be slow — give it 90s
  return runFFmpeg(ff, args, ['in.mp4', 'cover.jpg'], 'out.mp4', 90_000);
}

// ─── Strategy B: metadata only (no cover) ─────────────────────────────────────

async function embedMetaOnly(
  ff: FFmpeg,
  audioData: Uint8Array,
  meta: {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year: string;
  publisher: string;
  copyright: string;
},
): Promise<Uint8Array> {
  await ff.writeFile('in.mp4', audioData);

  const args = [
    '-i', 'in.mp4',
    '-c', 'copy',
    '-metadata', `title=${meta.title}`,
    '-metadata', `artist=${meta.artist}`,
    '-metadata', `album=${meta.album}`,
    '-metadata', `date=${meta.year}`,
    '-metadata', `publisher=${meta.publisher}`,
    '-metadata', `copyright=${meta.copyright}`,
    '-metadata', 'comment=Downloaded via saavn-dl / Rhythmax',
    '-movflags', '+faststart',
    'out_meta.mp4',
  ];

  return runFFmpeg(ff, args, ['in.mp4'], 'out_meta.mp4', 45_000);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface DownloadOptions {
  song: SaavnSong;
  quality: string;
  onProgress?: (stage: string, percent: number) => void;
  overrideMeta?: TrackMetadata;
  overrideFilename?: string;
}

export async function downloadWithMetadata(opts: DownloadOptions): Promise<void> {
  const { song, quality, onProgress, overrideMeta, overrideFilename } = opts;
  const { more_info } = song;

  const encryptedMediaUrl =
  song.encrypted_media_url ||
  more_info?.encrypted_media_url;

  if (!encryptedMediaUrl) {
  throw new Error('Missing encrypted media URL');
  }

  onProgress?.('Decrypting URL…', 8);
  const decrypted = decryptMediaUrl(encryptedMediaUrl);
  const audioUrl = getQualityUrl(decrypted, quality);

  onProgress?.('Fetching audio…', 18);
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
  const audioBlob = await audioResp.blob();
  if (audioBlob.size < 1024) throw new Error('Audio response is empty — URL may have expired');

  onProgress?.('Fetching cover art…', 32);
  let coverData: Uint8Array | null = null;
  try {
    const imgResp = await fetch(getImageUrl(song));
    if (imgResp.ok) {
      const imgBlob = await imgResp.blob();
      if (imgBlob.size > 500) {
        coverData = new Uint8Array(await imgBlob.arrayBuffer());
      }
    }
  } catch {
    // cover is optional
  }

  onProgress?.('Loading ffmpeg…', 48);
  const ff = await getFFmpeg();

  const audioData = new Uint8Array(await audioBlob.arrayBuffer());
  const artist = getArtistTag(song);
  const meta = overrideMeta
  ? {
      title:       overrideMeta.title,
      artist:      overrideMeta.artist,
      albumArtist: overrideMeta.albumArtist,
      album:       overrideMeta.album,
      year:        overrideMeta.year,
      publisher:   more_info.label,
      copyright:   overrideMeta.copyright,
      comment:     overrideMeta.comment,
      genre:       overrideMeta.genre,
      trackNumber: overrideMeta.trackNumber,
      discNumber:  overrideMeta.discNumber,
      composer:    overrideMeta.composer,
    }
  : {
      title:       song.title,
      artist,
      albumArtist: artist,
      album:       more_info.album,
      year:        song.year,
      publisher:   more_info.label,
      copyright:   more_info.copyright_text,
      comment:     'Downloaded via saavn-dl / Rhythmax',
      genre:       '',
      trackNumber: '',
      discNumber:  '',
      composer:    '',
    };

  let outputData: Uint8Array;
  let usedCover = false;

  if (coverData) {
    onProgress?.('Embedding cover + metadata…', 62);
    try {
      outputData = await embedWithCover(ff, audioData, coverData, meta);
      usedCover = true;
    } catch (err) {
      // Cover embedding failed — retry without cover
      console.warn('[saavn-dl] Cover embed failed, retrying without cover:', err);
      onProgress?.('Cover failed, embedding metadata only…', 72);
      outputData = await embedMetaOnly(ff, audioData, meta);
    }
  } else {
    onProgress?.('Embedding metadata…', 62);
    outputData = await embedMetaOnly(ff, audioData, meta);
  }

  onProgress?.('Preparing download…', 92);
  const buf = toArrayBuffer(outputData);
  const finalBlob = new Blob([buf], { type: 'audio/mp4' });

  console.info(
    `[saavn-dl] Final: ${(finalBlob.size / 1024 / 1024).toFixed(2)} MB` +
    ` | cover=${usedCover} | quality=${quality}kbps`
  );

  const filename = sanitizeFilename(overrideFilename ?? `${meta.title} - ${meta.artist}`) + '.m4a';
  triggerDownload(finalBlob, filename);
  onProgress?.('Done!', 100);
}

export async function downloadDirect( song: SaavnSong, quality: string, overrideFilename?: string,): Promise<void> {
  const { more_info } = song;
  const encryptedMediaUrl =
  song.encrypted_media_url ||
  more_info?.encrypted_media_url;

  if (!encryptedMediaUrl) {
    throw new Error('Missing encrypted media URL');
  }

  const decrypted = decryptMediaUrl(encryptedMediaUrl);
  const audioUrl = getQualityUrl(decrypted, quality);
  const artist = getArtistTag(song);
  const filename = sanitizeFilename( overrideFilename ?? `${song.title} - ${artist}` ) + '.m4a';
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (blob.size < 1024) throw new Error('Received empty file');
  triggerDownload(blob, filename);
}
