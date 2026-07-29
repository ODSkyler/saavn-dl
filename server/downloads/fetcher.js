/**
 * Allowlisted server-side fetcher for audio/cover URLs.
 *
 * Shares the host allowlist and redirect cap with server/proxy.js so the download
 * engine can only reach the same trusted origins as the browser proxy. Buffers the
 * full upstream response into a Buffer (matching the proxy's behaviour) and supports
 * cancellation via an AbortSignal.
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { isAllowedHost } from '../proxy.js';

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;
// Guard against a hostile/broken upstream streaming unbounded data at us.
const MAX_RESPONSE_BYTES = 200 * 1024 * 1024; // 200 MB

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class FetchError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

/**
 * Fetch an allowlisted URL and return the full response body as a Buffer.
 *
 * @param {string} targetUrlStr        the URL to fetch
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]   cancels the in-flight request
 * @param {number} [opts._redirectCount] internal redirect counter
 * @returns {Promise<Buffer>}
 */
export function fetchAllowed(targetUrlStr, { signal, _redirectCount = 0 } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new FetchError('Aborted', { status: 0 }));
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      reject(new FetchError(`Invalid URL: ${targetUrlStr}`, { status: 400 }));
      return;
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      reject(new FetchError('Only HTTP/HTTPS URLs are supported', { status: 400 }));
      return;
    }

    if (!isAllowedHost(targetUrl.hostname)) {
      reject(new FetchError(`Host "${targetUrl.hostname}" is not in the allowlist`, { status: 403 }));
      return;
    }

    const requestFn = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(arg);
    };

    const req = requestFn(options, (resp) => {
      // Redirect handling (reuse proxy's up-to-3-hops policy).
      if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
        resp.resume(); // drain
        if (_redirectCount >= MAX_REDIRECTS) {
          finish(reject, new FetchError('Too many redirects', { status: 508 }));
          return;
        }
        let redirectUrl;
        try {
          redirectUrl = new URL(resp.headers.location, targetUrlStr);
        } catch {
          finish(reject, new FetchError('Invalid redirect location', { status: 502 }));
          return;
        }
        if (!isAllowedHost(redirectUrl.hostname)) {
          finish(reject, new FetchError(`Redirect to disallowed host: ${redirectUrl.hostname}`, { status: 403 }));
          return;
        }
        // Recurse for the redirect; forward resolution/rejection.
        fetchAllowed(redirectUrl.href, { signal, _redirectCount: _redirectCount + 1 })
          .then((buf) => finish(resolvePromise, buf))
          .catch((err) => finish(reject, err));
        return;
      }

      const status = resp.statusCode || 0;
      if (status < 200 || status >= 300) {
        resp.resume();
        finish(reject, new FetchError(`Upstream responded with HTTP ${status}`, { status }));
        return;
      }

      const chunks = [];
      let size = 0;
      resp.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy();
          finish(reject, new FetchError('Response exceeds maximum allowed size', { status: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      resp.on('end', () => finish(resolvePromise, Buffer.concat(chunks)));
      resp.on('error', (err) => finish(reject, new FetchError(`Upstream read failed: ${err.message}`, { status: 502 })));
    });

    req.on('error', (err) => {
      if (signal?.aborted) {
        finish(reject, new FetchError('Aborted', { status: 0 }));
      } else {
        finish(reject, new FetchError(`Fetch failed: ${err.message}`, { status: 502 }));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      finish(reject, new FetchError('Request timed out', { status: 504 }));
    });

    const onAbort = () => {
      req.destroy();
      finish(reject, new FetchError('Aborted', { status: 0 }));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    req.end();
  });
}
