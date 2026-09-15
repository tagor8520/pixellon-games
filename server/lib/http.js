/**
 * HTTP plumbing for the API layer: query validation, JSON/ETag responses and
 * CDN cache headers.
 *
 * The cache headers are the whole point of this file for hosting cost:
 *   Cache-Control: public, max-age=<browser>, s-maxage=<cdn>, stale-while-revalidate=<swr>
 * A shared CDN cache turns 10 000 visitors of `/api/news` into ONE origin hit
 * per TTL window, and SWR means users never wait for a revalidation.
 */

import { UpstreamError } from './upstream.js';

/* ── query validation ───────────────────────────────────────────── */

/**
 * Whitelist + coerce query params. Anything not declared is dropped, so an
 * attacker cannot smuggle arbitrary upstream parameters through our key.
 *
 * @param {URLSearchParams} searchParams
 * @param {Record<string, { type?: 'string'|'int'|'bool', maxLength?: number, min?: number, max?: number, default?: any, pattern?: RegExp }>} spec
 */
export function parseParams(searchParams, spec) {
  /** @type {Record<string, any>} */
  const out = {};
  const invalid = [];

  for (const [name, rule] of Object.entries(spec)) {
    const raw = searchParams.get(name);
    if (raw === null || raw === '') {
      if (rule.default !== undefined) out[name] = rule.default;
      continue;
    }
    const trimmed = raw.trim();
    if (rule.maxLength && trimmed.length > rule.maxLength) {
      invalid.push(`${name} too long`);
      continue;
    }
    if (rule.pattern && !rule.pattern.test(trimmed)) {
      invalid.push(`${name} has an unsupported value`);
      continue;
    }
    if (rule.type === 'int') {
      const n = Number.parseInt(trimmed, 10);
      if (Number.isNaN(n)) {
        invalid.push(`${name} must be a number`);
        continue;
      }
      out[name] = clampInt(n, rule.min, rule.max);
      continue;
    }
    if (rule.type === 'number') {
      const n = Number.parseFloat(trimmed);
      if (Number.isNaN(n)) {
        invalid.push(`${name} must be a number`);
        continue;
      }
      if (rule.min !== undefined && n < rule.min) { invalid.push(`${name} below minimum`); continue; }
      if (rule.max !== undefined && n > rule.max) { invalid.push(`${name} above maximum`); continue; }
      out[name] = n;
      continue;
    }
    if (rule.type === 'bool') {
      out[name] = trimmed === 'true' || trimmed === '1';
      continue;
    }
    out[name] = trimmed;
  }

  return { params: out, invalid };
}

export function clampInt(value, min = -Infinity, max = Infinity) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/* ── responses ──────────────────────────────────────────────────── */

/** Weak ETag over the serialised body — cheap 304s for repeat visitors. */
export function weakEtag(body) {
  const input = typeof body === 'string' ? body : JSON.stringify(body);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${(hash >>> 0).toString(36)}-${input.length.toString(36)}"`;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {object} opts
 * @param {number} opts.status
 * @param {any} opts.body
 * @param {number} opts.ttlMs
 * @param {number} [opts.swrMs]
 * @param {number} [opts.browserTtlMs] defaults to a fraction of the CDN TTL
 * @param {{state: string, cacheKey: string}} [opts.meta]
 */
export function sendJson(res, { status = 200, body, ttlMs = 0, swrMs = 0, browserTtlMs, meta }) {
  const payload = JSON.stringify(body ?? null);
  const etag = weakEtag(payload);

  if (ttlMs > 0) {
    const browser = browserTtlMs ?? Math.min(Math.round(ttlMs / 4), 300_000);
    const directives = [
      'public',
      `max-age=${Math.round(browser / 1000)}`,
      `s-maxage=${Math.round(ttlMs / 1000)}`,
    ];
    if (swrMs > 0) directives.push(`stale-while-revalidate=${Math.round(swrMs / 1000)}`);
    res.setHeader('Cache-Control', directives.join(', '));
    // Tell CDNs to keep serving this even while revalidating at the origin.
    res.setHeader('CDN-Cache-Control', `max-age=${Math.round((ttlMs + swrMs) / 1000)}`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }

  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Cache', meta ? `${meta.state}` : 'bypass');
  if (meta?.cacheKey) res.setHeader('X-Cache-Key', meta.cacheKey);

  res.statusCode = status;
  res.end(payload);
}

/** 304 helper — keeps bandwidth near zero for repeat page views. */
export function sendNotModified(res, etag) {
  res.statusCode = 304;
  res.setHeader('ETag', etag);
  res.end();
}

/** @param {import('node:http').ServerResponse} res */
export function sendError(res, error, { route = 'unknown' } = {}) {
  const status = error instanceof UpstreamError ? error.status : (error?.status ?? 500);
  const message =
    error instanceof UpstreamError
      ? error.message
      : 'Something went wrong while talking to an upstream service.';

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  res.end(
    JSON.stringify({
      error: {
        route,
        status: res.statusCode,
        message,
        // Upstream detail stays server-side (it can contain our key in URLs).
        hint: status === 502 || status === 504 ? 'upstream_unavailable' : undefined,
      },
    }),
  );
}

/** Read + JSON-parse a request body with a size cap (used by POST proxies). */
export async function readBody(req, { maxBytes = 16 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
