/**
 * Production server: static `dist/` + API, no framework.
 *
 *     npm run build && npm run serve         # → http://localhost:4173
 *
 * Deliberately boring — but it does the three things a naive static host gets
 * wrong for this app:
 *
 *   1. Immutable caching for hashed assets, `no-cache` for index.html, so a
 *      deploy is picked up instantly while repeat visits cost ~0 bytes.
 *   2. Compression (Brotli → gzip) from an mtime-keyed cache, because the JS
 *      bundle is the largest transfer on a cold visit.
 *   3. SPA fallback, so deep links like /codex/1234/bosses do not 404.
 *
 * Behind a CDN (recommended) most /api/* requests never reach this process:
 * every API response carries s-maxage + stale-while-revalidate so the CDN
 * serves the repeat traffic and the origin only handles cache misses.
 */

import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { createApi } from './api.js';
import { buildEnv } from './lib/env.js';

const ROOT = resolve(process.cwd());
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const COMPRESS_MIN_BYTES = 1024;
const COMPRESS_CACHE_MAX = 64;

const env = buildEnv({ root: ROOT, base: process.env });
const api = createApi({ env });

/* ── static file handling ───────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest']);

/**
 * Vite hashes asset filenames, so they can be cached forever.
 * HTML must never be cached — it is what points at the new hashes.
 */
function cachePolicy(pathname) {
  if (pathname === '/' || pathname.endsWith('.html')) return 'no-cache, must-revalidate';
  // Vite fingerprints as `name-HASH.ext` (hash *before* the extension), and the
  // hash alphabet includes `-` and `_`. Getting this regex wrong silently drops
  // every asset to a 1-hour TTL — i.e. repeat visitors re-download the bundle.
  if (/^\/assets\/[^/]+-[0-9a-zA-Z_-]{8,}\.[a-z0-9]+$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/^\/(fonts|icons)\//.test(pathname)) return 'public, max-age=604800, stale-while-revalidate=86400';
  return 'public, max-age=3600';
}

/** Pre-compressed variants, keyed by path + mtime so a rebuild invalidates. */
const compressed = new Map();

function encode(filePath, body, ext, acceptEncoding) {
  if (!COMPRESSIBLE.has(ext) || body.length < COMPRESS_MIN_BYTES) return { body, encoding: null };
  const stat = statSync(filePath);
  const key = `${filePath}:${stat.mtimeMs}`;
  let variants = compressed.get(key);
  if (!variants) {
    variants = {};
    if (compressed.size >= COMPRESS_CACHE_MAX) compressed.delete(compressed.keys().next().value);
    compressed.set(key, variants);
  }
  const wantsBr = acceptEncoding.includes('br');
  const wantsGzip = !wantsBr && acceptEncoding.includes('gzip');
  if (!wantsBr && !wantsGzip) return { body, encoding: null };

  if (wantsBr) {
    variants.br ??= brotliCompressSync(body, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length },
    });
    return { body: variants.br, encoding: 'br' };
  }
  variants.gzip ??= gzipSync(body, { level: 6 });
  return { body: variants.gzip, encoding: 'gzip' };
}

function safeJoin(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function sendFile(req, res, filePath, { status = 200 } = {}) {
  const ext = extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', cachePolicy(filePath.slice(DIST.length) || '/'));
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (status !== 200) {
    res.statusCode = status;
    res.end('Not found');
    return;
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';

  // Text assets are small enough to hold in memory, and compressing them
  // (cached) is almost always cheaper than sending them raw.
  if (COMPRESSIBLE.has(ext)) {
    try {
      const body = readFileSync(filePath);
      const { body: out, encoding } = encode(filePath, body, ext, acceptEncoding);
      if (encoding) res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(out.length));
      res.statusCode = 200;
      if (req.method === 'HEAD') return res.end();
      res.end(out);
      return;
    } catch {
      /* fall through to streaming */
    }
  }

  res.statusCode = 200;
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).on('error', () => res.end()).pipe(res);
}

/* ── server ─────────────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.end();
      return;
    }
    try {
      await api.handle(req, res);
    } catch (error) {
      console.error('[server] api failure', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"error":{"message":"internal error"}}');
      }
    }
    return;
  }

  const target = safeJoin(DIST, url.pathname === '/' ? '/index.html' : url.pathname);
  if (target) {
    try {
      if (statSync(target).isFile()) return sendFile(req, res, target);
    } catch {
      /* fall through to the SPA fallback */
    }
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && !extname(url.pathname)) {
    return sendFile(req, res, join(DIST, 'index.html'));
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  const credentials = ['RAWG_API_KEY', 'STEAM_WEB_API_KEY', 'TWITCH_CLIENT_ID', 'TWITCH_APP_TOKEN', 'PANDASCORE_API_KEY']
    .map((key) => `${key}=${env[key] ? 'set' : 'MISSING'}`)
    .join('  ');
  console.log(`\n  Pixellon serving dist/ on http://${HOST}:${PORT}`);
  console.log(`  health   http://localhost:${PORT}/api/health`);
  console.log(`  creds    ${credentials}`);
  console.log(`  policy   cache ${env.API_CACHE_MAX_ENTRIES || 2000} entries · rate limit ${env.API_RATE_LIMIT || 240}/min\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
