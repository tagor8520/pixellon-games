/**
 * Edge-runtime adapter (Cloudflare Workers / Vercel Edge / Deno Deploy).
 *
 *     // worker.js
 *     import { createEdgeHandler } from './server/edge.js';
 *     export default { fetch: createEdgeHandler() };
 *
 * It reuses the exact same router as Node by bridging a Web `Request` into the
 * minimal request/response surface the router expects — so dev, origin and edge
 * can never drift apart.
 *
 * ⚠️ Isolate-local cache
 * The TtlCache lives in the isolate's memory. Edge runtimes spawn many isolates,
 * so treat it as a *latency* cache, not a global one: the real cross-isolate
 * cache is the platform's HTTP cache, which already applies because every
 * response carries `Cache-Control`/`CDN-Cache-Control`. For shared key-value
 * caching pass a `store` implementation backed by KV/Durable Objects.
 */

import { createApi } from './api.js';

/** Minimal Node-ish request/response shim over Web APIs. */
function toNodeAdapter(request, bodyText) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) headers[key.toLowerCase()] = value;
  const url = new URL(request.url);

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress: headers['cf-connecting-ip'] || headers['x-real-ip'] || 'edge' },
    body: bodyText,
  };

  let statusCode = 200;
  const outHeaders = new Headers();
  let payload = '';

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = value;
    },
    headersSent: false,
    setHeader(key, value) {
      outHeaders.set(key, String(value));
    },
    getHeader(key) {
      return outHeaders.get(key);
    },
    end(chunk) {
      payload = chunk === undefined ? '' : String(chunk);
      this.headersSent = true;
    },
  };

  return { req, res, read: () => ({ statusCode, headers: outHeaders, payload }) };
}

/**
 * @param {{ env?: Record<string, string>, log?: Function }} [opts]
 */
export function createEdgeHandler({ env = {}, log = console.log } = {}) {
  const api = createApi({ env, log });

  return async function fetch(request) {
    const { req, res, read } = toNodeAdapter(request);
    const handled = await api.handle(req, res);
    if (!handled) {
      return new Response(JSON.stringify({ error: { message: 'Unknown API route' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { statusCode, headers, payload } = read();
    return new Response(statusCode === 304 ? null : payload, { status: statusCode, headers });
  };
}

export default createEdgeHandler;
