/**
 * Production-server self-test — `npm run test:serve`
 *
 * Boots `server/standalone.js` (the real thing, not a stub) against a mock
 * upstream and asserts over HTTP that the deployment story actually holds:
 *
 *   • hashed assets are immutable, HTML is never cached (deploy safety)
 *   • Brotli/gzip is negotiated and applied to JS/CSS/HTML
 *   • deep links fall back to index.html (SPA routing survives a refresh)
 *   • /api responses carry s-maxage + stale-while-revalidate (CDN offload)
 *   • a repeat request is served from the in-process cache (X-Cache)
 *   • ETag revalidation returns 304 with an empty body
 *   • traversal attempts cannot escape dist/
 *
 * Requires a prior `npm run build`.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

if (!existsSync('dist/index.html')) {
  console.error('\n  ✗ dist/index.html missing — run `npm run build` first\n');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const queued = [];
const test = (name, fn) => queued.push({ name, fn });

/* ── mock upstream ──────────────────────────────────────────────── */

function startMock() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/rawg/games') {
      return res.end(
        JSON.stringify({
          results: Array.from({ length: 5 }, (_, i) => ({
            id: 1000 + i,
            name: `Serve Test Game ${i}`,
            metacritic: 85,
            released: '2026-01-01',
            background_image: 'https://media.rawg.io/media/games/x.jpg',
            parent_platforms: [{ platform: { name: 'PC' } }],
            genres: [{ name: 'Action' }],
          })),
        }),
      );
    }
    res.statusCode = 404;
    res.end('{"error":"no"}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ── boot the real server ───────────────────────────────────────── */

const mock = await startMock();
const mockPort = mock.address().port;
const PORT = 4899;

const child = spawn(process.execPath, ['server/standalone.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    RAWG_API_KEY: 'selftest-rawg-key-0123456789',
    RAWG_API_BASE: `http://127.0.0.1:${mockPort}/rawg`,
    API_RATE_LIMIT: 'off',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', () => {});
child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

const base = `http://127.0.0.1:${PORT}`;

async function waitForServer(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

const call = (path, init) => fetch(`${base}${path}`, init);

/* ── tests ─────────────────────────────────────────────────────── */

test('HTML is served uncompressed-cached (no-cache) so deploys take effect at once', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  const html = await res.text();
  assert.match(html, /Pixellon/);
  assert.ok(!html.includes('RAWG'), 'key material leaked into HTML');
});

test('compression: brotli when offered, gzip otherwise', async () => {
  // Note: Node's fetch transparently decompresses, so the byte counts come from
  // Content-Length (which the server sets to the compressed size) rather than
  // from re-decoding the body here.
  const identity = await call('/', { headers: { 'accept-encoding': 'identity' } });
  const identityText = await identity.text();
  const rawLength = Number(identity.headers.get('content-length')) || identityText.length;

  const br = await call('/', { headers: { 'accept-encoding': 'br' } });
  assert.equal(br.headers.get('content-encoding'), 'br');
  assert.equal(await br.text(), identityText, 'brotli payload mismatch');
  const brLength = Number(br.headers.get('content-length'));

  const gz = await call('/', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers.get('content-encoding'), 'gzip');
  assert.equal(await gz.text(), identityText, 'gzip payload mismatch');
  const gzLength = Number(gz.headers.get('content-length'));

  assert.ok(brLength < rawLength, `brotli did not shrink: ${brLength} vs ${rawLength}`);
  assert.ok(gzLength < rawLength, `gzip did not shrink: ${gzLength} vs ${rawLength}`);
  console.log(
    `      ↳ index.html ${rawLength} B → br ${brLength} B (${(100 - (brLength / rawLength) * 100).toFixed(0)}%) · gzip ${gzLength} B (${(100 - (gzLength / rawLength) * 100).toFixed(0)}%)`,
  );
});

test('hashed assets are immutable for a year', async () => {
  const asset = readdirSync('dist/assets').find((f) => f.endsWith('.js'));
  const res = await call(`/assets/${asset}`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  await res.arrayBuffer();
});

test('SPA fallback: a deep link returns the app shell, not a 404', async () => {
  for (const path of ['/codex/326243/bosses', '/deals', '/profile']) {
    const res = await call(path);
    assert.equal(res.status, 200, `${path} → ${res.status}`);
    const html = await res.text();
    assert.match(html, /<div id="root">/, `${path} did not return the shell`);
  }
});

test('a missing static file still 404s (no fallback for asset paths)', async () => {
  const res = await call('/assets/definitely-not-real.js');
  assert.equal(res.status, 404);
});

test('path traversal cannot escape dist/', async () => {
  const res = await call('/../package.json');
  assert.equal(res.status, 404);
  const second = await call('/..%2f..%2fpackage.json');
  assert.notEqual(second.status, 200);
  await second.text();
});

test('API responses carry CDN cache headers + ETag', async () => {
  const res = await call('/api/home');
  assert.equal(res.status, 200);
  const cacheControl = res.headers.get('cache-control');
  assert.match(cacheControl, /public, max-age=\d+, s-maxage=\d+, stale-while-revalidate=\d+/);
  assert.match(res.headers.get('cdn-cache-control'), /max-age=\d+/);
  assert.ok(res.headers.get('etag'));
  assert.equal(res.headers.get('x-cache'), 'miss');
  const body = await res.json();
  // The home bundle caps each feed at the number of cards the UI renders.
  assert.equal(body.trending.length, 3);
  assert.equal(body.topRated.length, 4);
  assert.ok(body.upcoming.length > 0);
});

test('repeat API request is served from cache (no upstream trip)', async () => {
  const first = await call('/api/games/trending');
  await first.json();
  const second = await call('/api/games/trending');
  const body = await second.json();
  assert.equal(body.length, 5);
  assert.notEqual(second.headers.get('x-cache'), 'miss');
});

test('ETag revalidation returns 304 with no body', async () => {
  const first = await call('/api/games/top-rated');
  const etag = first.headers.get('etag');
  await first.json();
  const second = await call('/api/games/top-rated', { headers: { 'if-none-match': etag } });
  assert.equal(second.status, 304);
  assert.equal((await second.text()).length, 0);
});

test('health endpoint exposes cache economics and credential state', async () => {
  const res = await call('/api/health');
  const health = await res.json();
  assert.equal(health.ok, true);
  assert.equal(health.credentials.RAWG_API_KEY, 'configured');
  assert.equal(health.credentials.TWITCH_CLIENT_ID, 'missing');
  assert.ok(health.cache.entries > 0);
  assert.ok(health.cache.hitRate > 0, 'cache hit rate should be non-zero after the tests above');
  console.log(
    `      ↳ cache: ${health.cache.entries} entries, hit rate ${(health.cache.hitRate * 100).toFixed(0)}%, ${health.cache.savedUpstreamCalls} upstream calls avoided`,
  );
});

test('unknown API route returns a JSON 404 instead of the SPA shell', async () => {
  const res = await call('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  await res.json();
});

/* ── run ───────────────────────────────────────────────────────── */

await waitForServer();

for (const { name, fn } of queued) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

child.kill('SIGTERM');
mock.close();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
