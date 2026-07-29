/**
 * Server-side proxy for external resource fetching.
 * Routes audio/image requests through the server (and thus through gluetun VPN)
 * instead of having the browser fetch them directly.
 *
 * Endpoint:
 *   GET /api/proxy?url=<encoded-url>
 *
 * Allowed origins (security):
 *   - *.saavncdn.com (audio streams)
 *   - *.jiosaavn.com (images, API)
 *   - c.saavncdn.com, c.sop.saavncdn.com (CDN variants)
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

// Allowlist of domains the proxy will fetch from
const ALLOWED_HOSTS = [
  'aac.saavncdn.com',
  'c.saavncdn.com',
  'c.sop.saavncdn.com',
  'snp.saavncdn.com',
  'sdl.saavncdn.com',
  'www.saavncdn.com',
  'saavncdn.com',
  'c.saavncdn.com',
  'pli.saavncdn.com',
  'pagalworld.com.se',
];

// Also allow any subdomain of these base domains
const ALLOWED_SUFFIXES = [
  '.saavncdn.com',
  '.jiosaavn.com',
  '.jio.com',
  '.vercel.app',
  '.workers.dev',
];

export function isAllowedHost(hostname) {
  if (ALLOWED_HOSTS.includes(hostname)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Handle GET /api/proxy?url=<encoded-url>
 * Streams the remote response back to the client.
 */
export function handleProxyRoute(req, res, url, jsonResponse) {
  if (req.method !== 'GET') {
    jsonResponse(res, 405, { error: 'Method not allowed' });
    return true;
  }

  const targetUrlStr = url.searchParams.get('url');
  if (!targetUrlStr) {
    jsonResponse(res, 400, { error: 'Missing "url" query parameter' });
    return true;
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid URL' });
    return true;
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    jsonResponse(res, 400, { error: 'Only HTTP/HTTPS URLs are supported' });
    return true;
  }

  if (!isAllowedHost(targetUrl.hostname)) {
    jsonResponse(res, 403, { error: `Host "${targetUrl.hostname}" is not in the allowlist` });
    return true;
  }

  const requestFn = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity', // No compression — stream raw bytes
    },
    timeout: 60_000,
  };

  const proxyReq = requestFn(options, (proxyRes) => {
    // Follow redirects (up to 3)
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      const redirectUrl = new URL(proxyRes.headers.location, targetUrlStr);
      if (!isAllowedHost(redirectUrl.hostname)) {
        jsonResponse(res, 403, { error: `Redirect to disallowed host: ${redirectUrl.hostname}` });
        return;
      }
      // Rewrite the URL param and recurse
      const newUrl = new URL(req.url, `http://localhost`);
      newUrl.searchParams.set('url', redirectUrl.href);
      handleProxyRoute(req, res, newUrl, jsonResponse);
      proxyRes.resume(); // Drain the redirect response
      return;
    }

    // Set COOP/COEP headers for SharedArrayBuffer compatibility
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    // Forward relevant headers
    const contentType = proxyRes.headers['content-type'];
    if (contentType) res.setHeader('Content-Type', contentType);

    // Buffer the entire upstream response before sending to client.
    // This prevents "Content-Length exceeds response Body" errors when
    // the upstream CDN drops the connection mid-stream — we only send
    // Content-Length once we know the actual received byte count.
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);
      res.setHeader('Content-Length', body.length);
      // Allow browser to read response (CORS)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(proxyRes.statusCode || 200);
      res.end(body);
    });
    proxyRes.on('error', (err) => {
      console.error('[api-proxy] Upstream read error:', err.message);
      if (!res.headersSent) {
        jsonResponse(res, 502, { error: `Upstream read failed: ${err.message}` });
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[api-proxy] Request error:', err.message);
    if (!res.headersSent) {
      jsonResponse(res, 502, { error: `Proxy fetch failed: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      jsonResponse(res, 504, { error: 'Proxy request timed out' });
    }
  });

  proxyReq.end();
  return true;
}
