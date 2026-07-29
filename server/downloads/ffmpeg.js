/**
 * ffmpeg wrapper — locates the ffmpeg binary and runs it via child_process.
 *
 * The server has no ffmpeg.wasm; instead it depends on the pinned `ffmpeg-static`
 * prebuilt binary (or a system binary via SAAVN_FFMPEG_PATH) and invokes it directly
 * with the same argument sets the client pipeline uses (stream copy, no re-encode).
 *
 * Unlike ffmpeg.wasm's in-memory FS, the native binary reads/writes temp files under
 * os.tmpdir()/saavn-dl/<jobId>/, which callers are responsible for cleaning up.
 */

import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ─── Binary resolution ──────────────────────────────────────────────────────

let cachedBinaryPath = null;

/**
 * Resolve the ffmpeg binary path.
 *   1. SAAVN_FFMPEG_PATH env override (e.g. an apt-installed /usr/bin/ffmpeg)
 *   2. the pinned `ffmpeg-static` prebuilt binary
 */
export function resolveFfmpegPath() {
  if (cachedBinaryPath) return cachedBinaryPath;

  const override = process.env.SAAVN_FFMPEG_PATH;
  if (override && override.trim()) {
    cachedBinaryPath = override.trim();
    return cachedBinaryPath;
  }

  try {
    // ffmpeg-static's default export is the absolute path to the binary.
    const staticPath = require('ffmpeg-static');
    if (staticPath && typeof staticPath === 'string') {
      cachedBinaryPath = staticPath;
      return cachedBinaryPath;
    }
  } catch {
    // ffmpeg-static not installed / not resolvable
  }

  // Last resort: rely on PATH.
  cachedBinaryPath = 'ffmpeg';
  return cachedBinaryPath;
}

// ─── Availability probe ─────────────────────────────────────────────────────

let probeResult = null;

/**
 * Probe whether the ffmpeg binary is present and executable.
 * Runs `ffmpeg -version` once and caches the boolean result.
 */
export function probeFfmpeg() {
  if (probeResult !== null) return Promise.resolve(probeResult);

  const bin = resolveFfmpegPath();
  return new Promise((resolvePromise) => {
    execFile(bin, ['-version'], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        console.warn(`[downloads/ffmpeg] probe failed for "${bin}": ${err.message}`);
        probeResult = false;
      } else {
        const version = String(stdout).split('\n')[0] || 'unknown';
        console.log(`[downloads/ffmpeg] using binary: ${bin} (${version.trim()})`);
        probeResult = true;
      }
      resolvePromise(probeResult);
    });
  });
}

// ─── Temp workspace ─────────────────────────────────────────────────────────

/** Base temp directory for all server-side download work. */
export function jobTempDir(jobId) {
  return join(tmpdir(), 'saavn-dl', String(jobId));
}

/** Create (if needed) and return the temp directory for a job. */
export async function ensureJobTempDir(jobId) {
  const dir = jobTempDir(jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Best-effort removal of a job's temp directory. */
export async function cleanupJobTempDir(jobId) {
  try {
    await rm(jobTempDir(jobId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export class FfmpegError extends Error {
  constructor(message, { code, stderr } = {}) {
    super(message);
    this.name = 'FfmpegError';
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Run ffmpeg with the given argument list.
 * Kills the child on timeout or when the provided AbortSignal fires.
 *
 * @param {string[]} args               full ffmpeg argument list
 * @param {object}   [opts]
 * @param {AbortSignal} [opts.signal]    abort in-flight processing
 * @param {number}   [opts.timeoutMs]    hard timeout (default 90s)
 * @returns {Promise<void>} resolves on exit code 0
 */
export function runFfmpeg(args, { signal, timeoutMs = 90_000 } = {}) {
  const bin = resolveFfmpegPath();

  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new FfmpegError('Aborted before ffmpeg started', { code: 'ABORT' }));
      return;
    }

    const child = execFile(
      bin,
      // -nostdin: never block waiting for stdin; -y: overwrite output files
      ['-nostdin', '-y', ...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        cleanup();
        if (err) {
          if (err.killed && signal?.aborted) {
            reject(new FfmpegError('ffmpeg aborted', { code: 'ABORT', stderr }));
          } else if (err.killed) {
            reject(new FfmpegError(`ffmpeg timed out after ${timeoutMs / 1000}s`, { code: 'TIMEOUT', stderr }));
          } else {
            reject(new FfmpegError(`ffmpeg failed: ${err.message}`, { code: err.code, stderr }));
          }
          return;
        }
        resolvePromise();
      },
    );

    const onAbort = () => {
      child.kill('SIGKILL');
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    function cleanup() {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  });
}
