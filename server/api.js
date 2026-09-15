/**
 * The API router.
 *
 * One request lifecycle:
 *   parse URL → match route → validate query → in-process cache →
 *   [hit]  reply immediately (X-Cache: fresh|stale|coalesced)
 *   [miss] run handler → store → reply
 *   always: ETag + Cache-Control/CDN-Cache-Control so the *next* request never
 *           reaches this process at all.
 *
 * Used by three hosts, unchanged: `vite dev` (middleware), `node
 * server/standalone.js` (production), and edge runtimes via `server/edge.js`.
 */

import { TtlCache } from './lib/cache.js';
import { createRateLimiter } from './lib/ratelimit.js';
import { parseParams, sendJson, sendError, sendNotModified, weakEtag } from './lib/http.js';
import { UpstreamError } from './lib/upstream.js';
import { createRoutes } from './routes.js';
import { NEGATIVE_TTL_MS } from './config.js';

const defaultLog = (msg, meta) => {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[api] ${msg}${suffix}`);
};

/**
 * @param {object} opts
 * @param {Record<string, string>} opts.env effective environment (server-side only)
 * @param {Function} [opts.log]
 * @param {number} [opts.maxEntries]
 * @param {boolean} [opts.rateLimit]
 */
export function createApi({ env = process.env, log = defaultLog, maxEntries, rateLimit } = {}) {
  const cache = new TtlCache({
    maxEntries: maxEntries ?? Number(env.API_CACHE_MAX_ENTRIES || 2000),
    log,
  });
  // 404s get their own tiny cache so a dead id cannot be used to spin upstream.
  const negativeCache = new TtlCache({ maxEntries: 500, log });
  const limiter = createRateLimiter({
    limit: Number(env.API_RATE_LIMIT || 240),
    windowMs: 60_000,
    log,
  });
  const routes = createRoutes({ env, log });
  const rateLimitEnabled = rateLimit ?? env.API_RATE_LIMIT !== 'off';
  const ttlScale = Number(env.API_TTL_SCALE || 1) || 1;

  const metrics = { requests: 0, cacheHits: 0, notModified: 0, errors: 0, rateLimited: 0, byRoute: {} };

  function clientId(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    return ip || req.socket?.remoteAddress || 'unknown';
  }

  /**
   * Handle a Node request. Returns true when the request was ours.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) return false;

    metrics.requests++;

    const route = routes.find((r) => r.method === req.method && r.match(url.pathname));
    if (!route) {
      sendJson(res, { status: 404, body: { error: { message: 'Unknown API route', path: url.pathname } } });
      return true;
    }
    metrics.byRoute[route.name] = (metrics.byRoute[route.name] || 0) + 1;

    // CORS: same-origin by default. Set API_CORS_ORIGIN to allow a separate app.
    const origin = req.headers?.origin;
    const allowedOrigin = env.API_CORS_ORIGIN;
    if (origin && allowedOrigin && (allowedOrigin === '*' || allowedOrigin.split(',').includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    if (rateLimitEnabled && route.name !== 'health') {
      const verdict = limiter.check(`${clientId(req)}:${route.name === 'search' ? 'search' : 'api'}`);
      res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
      if (!verdict.allowed) {
        metrics.rateLimited++;
        res.setHeader('Retry-After', String(verdict.retryAfterSec));
        sendJson(res, {
          status: 429,
          body: { error: { route: route.name, status: 429, message: 'Too many requests — slow down.' } },
        });
        return true;
      }
    }

    const matched = route.match(url.pathname) || {};
    const { params, invalid } = parseParams(url.searchParams, route.validate || {});
    if (invalid.length) {
      sendJson(res, { status: 400, body: { error: { route: route.name, status: 400, message: invalid.join('; ') } } });
      return true;
    }

    const paramsForKey = { ...matched, ...params };
    const ttlMs = (route.policy.ttl || 0) * ttlScale;
    const swrMs = (route.policy.swr || 0) * ttlScale;
    const ctx = {
      env,
      query: params,
      log,
      runtime: { cache, limiter, routes, metrics },
      signal: AbortSignal.timeout(Number(env.UPSTREAM_TOTAL_TIMEOUT_MS || 20_000)),
    };

    try {
      let body;
      let state = 'bypass';
      let key = null;

      if (ttlMs > 0) {
        key = `${route.name}:${JSON.stringify(paramsForKey)}`;
        const dead = negativeCache.peek(key);
        if (dead) {
          sendJson(res, { status: 404, body: dead.value, meta: { state: 'negative' } });
          return true;
        }
        const result = await cache.load(key, {
          ttlMs,
          staleTtlMs: swrMs,
          loader: () => route.handler(ctx, paramsForKey),
        });
        body = result.value;
        state = result.state;
        if (state !== 'miss') metrics.cacheHits++;
      } else {
        body = await route.handler(ctx, paramsForKey);
      }

      // Conditional GET: a returning visitor re-validates for ~0 bytes.
      const payload = JSON.stringify(body ?? null);
      const etag = weakEtag(payload);
      if (req.headers?.['if-none-match'] === etag) {
        metrics.notModified++;
        res.setHeader('Cache-Control', ttlMs > 0 ? `public, s-maxage=${Math.round(ttlMs / 1000)}` : 'no-store');
        sendNotModified(res, etag);
        return true;
      }

      sendJson(res, {
        status: 200,
        body,
        ttlMs,
        swrMs,
        browserTtlMs: route.policy.browser,
        meta: { state, cacheKey: key || undefined },
      });
      return true;
    } catch (error) {
      metrics.errors++;
      const status = error instanceof UpstreamError ? error.status : error?.status || 500;
      if (status === 404) {
        const envelope = { error: { route: route.name, status: 404, message: 'Not found in upstream source' } };
        negativeCache.set(`${route.name}:${JSON.stringify(paramsForKey)}`, envelope, NEGATIVE_TTL_MS);
      }
      if (!(error instanceof UpstreamError) || status >= 500) {
        log('route failed', { route: route.name, status, error: String(error?.message || error) });
      }
      sendError(res, error, { route: route.name });
      return true;
    }
  }

  return {
    handle,
    cache,
    negativeCache,
    limiter,
    routes,
    metrics,
    stats: () => ({
      metrics,
      cache: cache.stats(),
      negativeCache: negativeCache.stats(),
      rateLimit: limiter.stats(),
    }),
    close: () => cache.prune(),
  };
}

export default createApi;
