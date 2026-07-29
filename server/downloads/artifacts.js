/**
 * Browser-delivery artifact store.
 *
 * When a browser-delivery job (single-track direct, album zip, album individual) is
 * processed server-side, the completed file is written here and served to the browser via
 * GET /api/downloads/:id/artifact. Artifacts are deleted after retrieval and swept after a
 * configurable TTL to avoid unbounded disk growth (Req 7.4).
 */

import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { getDbPath } from '../db/index.js';

// Default: a sibling "artifacts" dir next to the SQLite DB (a mounted volume in Docker),
// overridable via SAAVN_ARTIFACT_DIR.
const ARTIFACT_DIR = process.env.SAAVN_ARTIFACT_DIR || join(dirname(getDbPath()), 'artifacts');

// TTL in seconds (default 24h).
export const ARTIFACT_TTL_SECONDS = (() => {
  const raw = parseInt(process.env.SAAVN_ARTIFACT_TTL || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 60 * 60;
})();

const CONTENT_TYPES = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.zip': 'application/zip',
};

export function getArtifactDir() {
  return ARTIFACT_DIR;
}

async function ensureArtifactDir() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
}

/** Strip anything that could escape the artifact dir; keep a readable name. */
function safeSegment(name) {
  return String(name).replace(/[\/\\]/g, '_').replace(/\.\./g, '_').slice(0, 200);
}

/**
 * Write a completed browser-delivery file into the artifact dir.
 * The on-disk name is prefixed with the job id to guarantee uniqueness; the
 * suggested download filename is returned separately.
 *
 * @returns {Promise<string>} absolute path to the written artifact
 */
export async function writeArtifact(jobId, filename, buffer) {
  await ensureArtifactDir();
  const onDisk = `${safeSegment(jobId)}__${safeSegment(filename)}`;
  const abs = join(ARTIFACT_DIR, onDisk);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(abs, buffer);
  return abs;
}

/** Best-effort delete of an artifact file. */
export async function deleteArtifact(absPath) {
  if (!absPath) return;
  try {
    await unlink(absPath);
  } catch {
    /* already gone */
  }
}

/**
 * Stream an artifact to an HTTP response with a download disposition.
 * Resolves true when the response finished, false if the file was missing.
 */
export function streamArtifact(res, absPath, downloadName) {
  return new Promise((resolve) => {
    if (!absPath || !existsSync(absPath)) {
      resolve(false);
      return;
    }

    const ext = extname(downloadName || absPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    const name = downloadName || basename(absPath);
    // ASCII fallback + RFC 5987 UTF-8 filename.
    const asciiName = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    const encoded = encodeURIComponent(name);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    const stream = createReadStream(absPath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
      resolve(false);
    });
    res.on('finish', () => resolve(true));
    stream.pipe(res);
  });
}

/**
 * Remove artifacts older than the TTL. Returns the number of files deleted.
 */
export async function sweepArtifacts(ttlSeconds = ARTIFACT_TTL_SECONDS) {
  if (!existsSync(ARTIFACT_DIR)) return 0;
  const cutoff = Date.now() - ttlSeconds * 1000;
  let removed = 0;
  try {
    const files = await readdir(ARTIFACT_DIR);
    for (const f of files) {
      const abs = join(ARTIFACT_DIR, f);
      try {
        const s = await stat(abs);
        if (s.isFile() && s.mtimeMs < cutoff) {
          await unlink(abs);
          removed++;
        }
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}
