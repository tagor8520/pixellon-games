/**
 * API self-test — `npm run test:api`
 *
 * Spins up a *mock* upstream (so it runs offline) and drives the real router
 * through it, asserting the cost behaviours we actually care about:
 *
 *   1. caching        — N client requests → 1 upstream call
 *   2. single-flight  — concurrent identical requests → 1 upstream call
 *   3. SWR            — an expired entry is served instantly, refreshed behind
 *   4. ETag/304       — a returning visitor revalidates for ~0 bytes
 *   5. validation     — arbitrary upstream params are rejected, not forwarded
 *   6. rate limiting  — a flood gets 429 instead of burning the shared key
 *   7. negative cache — dead ids do not hammer upstream
 *   8. projection     — upstream bytes vs bytes sent to the browser
 *   9. key custody    — no credential ever appears in a response body
 */

import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createApi } from '../server/api.js';

/* ── harness ────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const queued = [];
const test = (name, fn) => queued.push({ name, fn });

async function run() {
  for (const { name, fn } of queued) {
    try {
      await fn();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (error) {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.stack}`);
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

/* ── mock upstream ──────────────────────────────────────────────── */

const FAKE_RAWG_KEY = 'test-rawg-key-0123456789abcdef';
const FAKE_TWITCH_TOKEN = 'test-twitch-token-0123456789abcdef';
const FAKE_STEAM_KEY = 'test-steam-key-0123456789abcdef';

const hits = { total: 0, byPath: {}, bytes: 0 };

/** A deliberately fat RAWG-shaped payload: lots of fields the UI never renders. */
function fatRawgGame(i, extra = {}) {
  return {
    id: 1000 + i,
    slug: `game-${i}`,
    name: `Test Game ${i}`,
    name_original: `Test Game ${i}`,
    description: '<p>Long html description that list endpoints return.</p>',
    metacritic: 80 + (i % 15),
    released: '2026-01-15',
    tba: false,
    background_image: `https://media.rawg.io/media/games/test-${i}.jpg`,
    background_image_additional: `https://media.rawg.io/media/games/test-${i}-alt.jpg`,
    website: 'https://example.com',
    rating: 4.2,
    rating_top: 5,
    ratings: Array.from({ length: 8 }, (_, r) => ({ id: r, title: `rating ${r}`, count: 100 * r, percent: r * 3 })),
    ratings_count: 1234,
    reviews_text_count: '99',
    added: 4321,
    added_by_status: { yet: 1, owned: 2, beaten: 3, toplay: 4, dropped: 5, playing: 6 },
    playtime: 12,
    suggestions_count: 0,
    updated: '2026-02-01T10:00:00',
    esrb_rating: { id: 3, slug: 'mature', name: 'Mature' },
    platforms: [{ platform: { id: 4, slug: 'pc', name: 'PC' }, released_at: '2026-01-15', requirements: { minimum: 'x'.repeat(500) } }],
    parent_platforms: [{ platform: { id: 1, slug: 'pc', name: 'PC' } }],
    genres: [{ id: 4, slug: 'action', name: 'Action' }],
    stores: Array.from({ length: 10 }, (_, s) => ({ id: s, store: { slug: `store-${s}`, name: `Store ${s}` }, url: 'https://example.com/store' })),
    tags: Array.from({ length: 20 }, (_, t) => ({ id: t, slug: `tag-${t}`, name: `Tag ${t}`, language: 'eng', games_count: 10 })),
    short_screenshots: Array.from({ length: 6 }, (_, s) => ({ id: s, image: 'https://media.rawg.io/i.jpg' })),
    ...extra,
  };
}

function startMockUpstream() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      const key = url.pathname + (url.searchParams.get('appids') ? `?appids=${url.searchParams.get('appids')}` : '');
      hits.total++;
      hits.byPath[key] = (hits.byPath[key] || 0) + 1;

      const json = (body) => {
        const payload = JSON.stringify(body);
        hits.bytes += payload.length;
        res.setHeader('Content-Type', 'application/json');
        res.end(payload);
      };
      const body = Buffer.concat(chunks).toString();

      if (url.pathname === '/rawg/games') {
        return json({ count: 100, next: 'https://api.rawg.io/api/games?page=2', results: Array.from({ length: 20 }, (_, i) => fatRawgGame(i)) });
      }
      if (/^\/rawg\/games\/\d+$/.test(url.pathname)) {
        if (url.pathname.endsWith('/999999')) {
          res.statusCode = 404;
          return res.end('{"detail":"Not found."}');
        }
        return json(fatRawgGame(1, { description_raw: 'Body text. '.repeat(50) }));
      }
      if (/^\/rawg\/games\/\d+\/stores$/.test(url.pathname)) {
        return json({ count: 1, results: [{ id: 1, store_id: 1, url: 'https://store.steampowered.com/app/1091500/Elden_Ring/' }] });
      }
      if (url.pathname === '/steam/appdetails') {
        return json({
          [url.searchParams.get('appids')]: {
            success: true,
            data: {
              name: 'Test Game 1',
              is_free: false,
              price_overview: { final_formatted: '$59.99', initial: 5999 },
              header_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg',
              controller_support: 'full',
              short_description: 'A short blurb.',
              pc_requirements: { minimum: '<strong>OS:</strong> Windows 10<br>'.repeat(20) },
              screenshots: Array.from({ length: 20 }, (_, i) => ({ id: i, path_full: 'https://x/y.jpg' })),
            },
          },
        });
      }
      if (url.pathname === '/igdb/games') {
        assert.ok(body.includes('search "Test Game 1"'), 'IGDB query not forwarded');
        return json([{ name: 'Test Game 1', storyline: 'Storyline text', cover: { url: '//images.igdb.com/t_thumb/x.jpg' }, involved_companies: [{ company: { name: 'FromSoft' } }] }]);
      }
      if (url.pathname === '/cheapshark/deals') {
        return json(Array.from({ length: 60 }, (_, i) => ({ title: `Deal ${i}`, salePrice: '9.99', normalPrice: '19.99', savings: '50', dealID: `d${i}`, thumb: 't.jpg', storeID: '1', metacriticScore: '80', steamRatingPercent: '90', extraField: 'x'.repeat(100) })));
      }
      if (url.pathname === '/freetogame/games') {
        return json(Array.from({ length: 30 }, (_, i) => ({ id: i, title: `Free ${i}`, thumbnail: 't.jpg', short_description: 'd'.repeat(300), genre: 'MMO', platform: 'PC', publisher: 'p', developer: 'd', game_url: 'u', release_date: '2026-01-01', screenshots: ['a', 'b'] })));
      }
      if (url.pathname === '/rss2json') {
        return json({ status: 'ok', items: Array.from({ length: 20 }, (_, i) => ({ title: `News ${i}`, link: 'https://ign.com/x', guid: `g${i}`, pubDate: 'Mon, 01 Sep 2026 10:00:00 +0000', author: 'a', description: `<p>${'word '.repeat(120)}</p><script>alert(1)</script>`, thumbnail: 't.jpg', enclosure: { link: 'e.jpg' } })) });
      }
      if (url.pathname === '/twitch/streams') {
        return json({ data: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, user_name: `streamer${i}`, title: 'Title', viewer_count: 1000 + i, game_name: 'Game', thumbnail_url: 't.jpg', user_login: `streamer${i}`, started_at: '2026-09-01T00:00:00Z', language: 'en', tags: ['a', 'b'] })) });
      }
      if (url.pathname === '/pandascore/matches/upcoming') {
        return json(Array.from({ length: 25 }, (_, i) => ({ id: i, name: `Match ${i}`, begin_at: '2026-09-20T10:00:00Z', scheduled_at: '2026-09-20T10:00:00Z', status: 'not_started', league: { name: 'LEC', image_url: 'l.jpg' }, serie: { name: 'S1' }, tournament: { name: 'T' }, opponents: [{ opponent: { name: 'A', image_url: 'a.jpg' } }, { opponent: { name: 'B', image_url: 'b.jpg' } }], streams_list: [{ main: true, raw_url: 'https://twitch.tv/x', language: 'en' }], videogame: { name: 'LoL' } })));
      }
      if (url.pathname === '/steamspy') {
        return json({ owners: '1,000,000 .. 2,000,000', positive: 900, negative: 100, average_forever: 30, ccu: 1000, price: '5999', tags: { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9 } });
      }
      res.statusCode = 404;
      res.end('{"error":"unknown mock path"}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ── fake client ────────────────────────────────────────────────── */

function createClient(api, ip = '10.0.0.1') {
  return async function call(path, { headers = {}, method = 'GET' } = {}) {
    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      headersSent: false,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(String(chunk));
        this.headersSent = true;
      },
    };
    const req = {
      method,
      url: path,
      headers: { host: 'localhost', 'x-forwarded-for': ip, ...headers },
      socket: { remoteAddress: ip },
    };
    const handled = await api.handle(req, res);
    assert.ok(handled, `route not handled: ${path}`);
    return { status: res.statusCode, headers: res.headers, body: chunks.join(''), json: () => JSON.parse(chunks.join('') || 'null') };
  };
}

/* ── the tests ──────────────────────────────────────────────────── */

const { server: mock, port } = await startMockUpstream();
const base = `http://127.0.0.1:${port}`;

const env = {
  RAWG_API_KEY: FAKE_RAWG_KEY,
  STEAM_WEB_API_KEY: FAKE_STEAM_KEY,
  TWITCH_CLIENT_ID: 'test-client-id',
  TWITCH_APP_TOKEN: FAKE_TWITCH_TOKEN,
  PANDASCORE_API_KEY: 'test-pandascore-key',
  RAWG_API_BASE: `${base}/rawg`,
  STEAM_STORE_BASE: `${base}/steam`,
  STEAM_API_BASE: `${base}/steampowered`,
  IGDB_BASE: `${base}/igdb`,
  TWITCH_BASE: `${base}/twitch`,
  PANDASCORE_BASE: `${base}/pandascore`,
  CHEAPSHARK_BASE: `${base}/cheapshark`,
  FREETOGAME_BASE: `${base}/freetogame`,
  RSS2JSON_BASE: `${base}/rss2json`,
  STEAMSPY_BASE: `${base}/steamspy`,
  UPSTREAM_TIMEOUT_MS: '3000',
  API_RATE_LIMIT: 'off',
  API_CACHE_MAX_ENTRIES: '200',
  API_TTL_SCALE: '0.0005', // 10-minute routes expire in ~0.3s so SWR is testable
};

const api = createApi({ env, log: () => {} });
const call = createClient(api);

const upstreamCalls = (path) => hits.byPath[path] || 0;
const resetHits = () => {
  hits.total = 0;
  hits.byPath = {};
  hits.bytes = 0;
};

test('home bundle: three upstream calls, one client request', async () => {
  resetHits();
  const res = await call('/api/home');
  assert.equal(res.status, 200);
  assert.equal(res.json().trending.length, 3, 'trending should be capped at 3 cards');
  assert.equal(res.json().topRated.length, 4);
  assert.equal(res.json().upcoming.length, 12);
  assert.equal(upstreamCalls('/rawg/games'), 3, `expected 3 upstream calls, saw ${upstreamCalls('/rawg/games')}`);
  assert.match(res.headers['cache-control'], /s-maxage=\d+, stale-while-revalidate=\d+/);
  assert.ok(res.headers.etag, 'missing ETag');
  assert.equal(res.headers['x-cache'], 'miss');
});

test('cache: 25 client requests → still 3 upstream calls, all served fresh', async () => {
  const before = hits.total;
  for (let i = 0; i < 25; i++) {
    const res = await call('/api/home');
    assert.equal(res.status, 200);
    assert.notEqual(res.headers['x-cache'], 'miss');
  }
  assert.equal(hits.total, before, 'cache did not absorb repeat traffic');
  assert.ok(api.cache.stats().hitRate > 0.9, `hit rate ${api.cache.stats().hitRate}`);
});

test('single-flight: 20 concurrent cold requests → 1 upstream call', async () => {
  resetHits();
  const responses = await Promise.all(Array.from({ length: 20 }, () => call('/api/games/trending')));
  for (const res of responses) assert.equal(res.status, 200);
  assert.equal(upstreamCalls('/rawg/games'), 1, `expected 1 upstream call, saw ${upstreamCalls('/rawg/games')}`);
});

test('stale-while-revalidate: expired entry answers instantly, refreshes behind', async () => {
  // Dedicated instance with a tiny TTL scale so the window is milliseconds.
  const swrApi = createApi({ env: { ...env, API_TTL_SCALE: '0.0005' }, log: () => {} });
  const swrCall = createClient(swrApi, '10.0.0.9');
  resetHits();
  await swrCall('/api/news'); // news: 10 min TTL → ~300 ms scaled
  assert.equal(hits.byPath['/rss2json'], 1);
  await new Promise((r) => setTimeout(r, 500));
  const stale = await swrCall('/api/news');
  assert.equal(stale.status, 200, 'stale read must still succeed');
  assert.equal(stale.headers['x-cache'], 'stale', `expected a stale read, got ${stale.headers['x-cache']}`);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(hits.byPath['/rss2json'], 2, 'background revalidation did not run exactly once');
  assert.equal(swrApi.cache.stats().counters.stale, 1);
});

test('ETag: a returning visitor revalidates for 0 bytes (304)', async () => {
  const first = await call('/api/games/top-rated');
  assert.equal(first.status, 200);
  const again = await call('/api/games/top-rated', { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body, '');
});

test('projection: upstream payload is trimmed before it reaches the browser', async () => {
  resetHits();
  const detail = await call('/api/games/1001');
  assert.equal(detail.status, 200);
  const game = detail.json();
  assert.equal(game.name, 'Test Game 1');
  assert.equal(game.steamAppId, undefined, 'details route should not run the composite');
  assert.equal(game.platforms?.[0]?.platform?.name, 'PC');
  assert.ok(!('ratings' in game) && !('added_by_status' in game) && !('stores' in game), 'fat fields leaked through');
  const ratio = hits.bytes / detail.body.length;
  assert.ok(ratio > 4, `expected >4x projection saving, got ${ratio.toFixed(1)}x`);
  assert.ok(detail.body.length < 4096, `projected detail is ${detail.body.length} B, expected < 4 KB`);
  console.log(`      ↳ upstream ${hits.bytes} B → client ${detail.body.length} B (${ratio.toFixed(1)}x smaller)`);
});

test('composite wiki: 1 client request instead of 5-6', async () => {
  resetHits();
  const res = await call('/api/wiki/1001');
  assert.equal(res.status, 200);
  const wiki = res.json();
  assert.equal(wiki.steamAppId, '1091500');
  assert.equal(wiki.steam.price, '$59.99');
  assert.equal(wiki.igdb.involved_companies[0].company.name, 'FromSoft');
  assert.ok(wiki.description_raw.length > 100);
  assert.equal(hits.total, 4, `wiki composite should make 4 upstream calls, made ${hits.total}`);
  console.log(`      ↳ 1 browser request → ${hits.total} upstream calls, all cached together`);
});

test('validation: arbitrary upstream parameters are rejected', async () => {
  resetHits();
  const bad = await call('/api/games/by-genre?genre=not-a-real-genre');
  assert.equal(bad.status, 400);
  assert.equal(hits.total, 0, 'invalid input still reached upstream');

  const long = await call(`/api/games/search?q=${'a'.repeat(200)}`);
  assert.equal(long.status, 400);
  assert.equal(hits.total, 0);
});

test('search: short queries never reach upstream', async () => {
  const fresh = createApi({ env, log: () => {} });
  const freshCall = createClient(fresh, '10.0.0.11');
  resetHits();
  const res = await freshCall('/api/games/search?q=a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), []);
  assert.equal(hits.total, 0, `short query still hit upstream ${hits.total}x`);
});

test('rate limiting: a flood gets 429 instead of burning the key', async () => {
  const limited = createApi({ env: { ...env, API_RATE_LIMIT: '3' }, log: () => {} });
  const flood = createClient(limited);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await flood('/api/deals')).status);
  assert.deepEqual(statuses, [200, 200, 200, 429, 429], `unexpected statuses: ${statuses.join(',')}`);
});

test('negative cache: a dead id hits upstream once', async () => {
  resetHits();
  const first = await call('/api/games/999999');
  assert.equal(first.status, 404);
  assert.equal(upstreamCalls('/rawg/games/999999'), 1);
  const second = await call('/api/games/999999');
  assert.equal(second.status, 404);
  assert.equal(upstreamCalls('/rawg/games/999999'), 1, 'dead id was re-fetched');
});

test('news: remote markup is stripped before it reaches the DOM', async () => {
  const res = await call('/api/news');
  const item = res.json()[0];
  assert.ok(!/<script|<p>/i.test(item.description), 'html survived sanitisation');
  assert.ok(item.description.length <= 320, 'summary not truncated');
});

test('provider payloads are trimmed on every list route', async () => {
  const checks = [
    ['/api/deals', (b) => b.length === 60 && !('extraField' in b[0])],
    ['/api/free-games?platform=pc', (b) => b[0].title === 'Free 0' && !('screenshots' in b[0])],
    ['/api/streams', (b) => b.length === 40 && b[0].url === 'https://twitch.tv/streamer0'],
    ['/api/esports', (b) => b[0].league.name === 'LEC' && b[0].opponents.length === 2],
    ['/api/steamspy/app/1091500', (b) => b.tags.length === 8],
  ];
  for (const [path, check] of checks) {
    const res = await call(path);
    assert.equal(res.status, 200, `${path} → ${res.status}`);
    assert.ok(check(res.json()), `${path} payload not projected as expected`);
  }
});

test('key custody: credentials are redacted from server logs too', async () => {
  const logged = [];
  const noisy = createApi({ env: { ...env, RAWG_API_BASE: 'http://127.0.0.1:1/rawg' }, log: (msg, meta) => logged.push(JSON.stringify({ msg, meta })) });
  const noisyCall = createClient(noisy, '10.0.0.13');
  await noisyCall('/api/games/trending').catch(() => {});
  const text = logged.join('\n');
  assert.ok(!text.includes(FAKE_RAWG_KEY), 'the API key leaked into a log line');
  assert.ok(text.includes('REDACTED') || text === '', 'expected the failing URL to be redacted');
});

test('key custody: no credential ever appears in a response', async () => {
  resetHits();
  for (const path of ['/api/health', '/api/home', '/api/games/trending', '/api/wiki/1001', '/api/deals', '/api/news']) {
    const res = await call(path);
    for (const secret of [FAKE_RAWG_KEY, FAKE_TWITCH_TOKEN, FAKE_STEAM_KEY]) {
      assert.ok(!res.body.includes(secret), `credential leaked in ${path}`);
    }
  }
});

test('graceful degradation: a failing secondary source returns a partial page', async () => {
  // No Twitch/IGDB credentials → wiki still renders from RAWG + Steam.
  const bare = createApi({ env: { ...env, TWITCH_CLIENT_ID: '', TWITCH_APP_TOKEN: '', PANDASCORE_API_KEY: '' }, log: () => {} });
  const bareCall = createClient(bare, '10.0.0.7');
  const wiki = await bareCall('/api/wiki/1001');
  assert.equal(wiki.status, 200, `wiki returned ${wiki.status}: ${wiki.body.slice(0, 200)}`);
  assert.equal(wiki.json().igdb, null);
  const esports = await bareCall('/api/esports');
  assert.equal(esports.status, 200);
  assert.deepEqual(esports.json(), []);
  const streams = await bareCall('/api/streams');
  assert.deepEqual(streams.json(), []);
});

test('health endpoint reports cache economics', async () => {
  const res = await call('/api/health');
  const health = res.json();
  assert.equal(health.ok, true);
  assert.ok(health.cache.savedUpstreamCalls >= 0);
  assert.equal(health.credentials.RAWG_API_KEY, 'configured');
  assert.ok(health.routes.length > 15, 'route table looks empty');
});

/* ── run ────────────────────────────────────────────────────────── */

const ok = await run();

console.log(
  `  upstream calls avoided: ${api.cache.stats().savedUpstreamCalls}  ·  cache hit rate: ${(api.cache.stats().hitRate * 100).toFixed(1)}%\n`,
);

mock.close();
process.exit(ok ? 0 : 1);
