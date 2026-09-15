/**
 * Upstream fetch helpers.
 *
 * Everything that talks to a third party (RAWG, Steam, IGDB, Twitch, CheapShark…)
 * goes through here so we get, in one place:
 *   • a hard timeout (a hung upstream must never hold a worker forever)
 *   • bounded retries with exponential backoff + jitter, honouring Retry-After
 *   • a typed error that the router can turn into a correct HTTP status
 *   • no silent failures — quota problems show up in logs and /api/health
 */

export class UpstreamError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, retryable?: boolean, url?: string, body?: string, cause?: unknown }} [meta]
   */
  constructor(message, { status = 502, retryable = false, url, body, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryable = retryable;
    this.url = sanitizeUrl(url);
    this.body = body;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SECRET_QUERY = /([?&](?:key|api_key|apikey|token|access_token|client_secret|client_id)=)[^&]*/gi;

/**
 * Strip credentials out of a URL before it reaches a log line, an error message
 * or a stack trace. Upstream URLs carry our keys in the query string, so logging
 * them raw would leak exactly what this layer exists to protect.
 */
export function sanitizeUrl(url) {
  return String(url || '').replace(SECRET_QUERY, '$1REDACTED');
}

/** Full jitter backoff: 300ms, ~600ms, ~1200ms … */
const backoffMs = (attempt) => Math.round(300 * 2 ** (attempt - 1) * (0.5 + Math.random()));

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {'GET'|'POST'} [opts.method]
 * @param {Record<string,string>} [opts.headers]
 * @param {string} [opts.body]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries] extra attempts after the first (0 = no retry)
 * @param {AbortSignal} [opts.signal]
 * @param {'json'|'text'} [opts.parse]
 * @param {(msg: string, meta?: object) => void} [opts.log]
 * @returns {Promise<any>}
 */
export async function fetchUpstream(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 8000),
    retries = 2,
    signal,
    parse = 'json',
    log = () => {},
  } = opts;

  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const res = await fetch(url, { method, headers, body, signal: combined });

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const text = await safeText(res);
        lastError = new UpstreamError(`upstream responded ${res.status}`, {
          status: res.status === 429 ? 429 : 502,
          retryable: true,
          url,
          body: text.slice(0, 400),
        });
        if (attempt <= retries) {
          log('upstream: retrying', { url: sanitizeUrl(url), status: res.status, attempt });
          await sleep(retryAfter ? Math.min(retryAfter * 1000, 5000) : backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        // 4xx other than 429: our request is wrong or the resource is missing.
        // Retrying would burn quota for nothing.
        const text = await safeText(res);
        throw new UpstreamError(`upstream responded ${res.status}`, {
          status: res.status === 404 ? 404 : 502,
          retryable: false,
          url,
          body: text.slice(0, 400),
        });
      }

      if (parse === 'text') return await res.text();
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new UpstreamError('upstream returned invalid JSON', { status: 502, url, body: text.slice(0, 200) });
      }
    } catch (error) {
      lastError = error;
      if (error instanceof UpstreamError && !error.retryable) throw error;
      const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      if (attempt <= retries) {
        log('upstream: retrying after network error', {
          url: sanitizeUrl(url),
          attempt,
          error: String(error?.message || error),
        });
        await sleep(backoffMs(attempt));
        continue;
      }
      if (aborted) {
        throw new UpstreamError(
          error?.name === 'TimeoutError' ? 'upstream timed out' : 'request aborted',
          { status: 504, retryable: false, url, cause: error },
        );
      }
      throw new UpstreamError('upstream unreachable', { status: 502, retryable: false, url, cause: error });
    }
  }

  throw lastError instanceof UpstreamError
    ? lastError
    : new UpstreamError('upstream failed', { status: 502, cause: lastError });
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Form-encoded body helper (IGDB/Twitch style APIs). */
export const formHeaders = { 'Content-Type': 'text/plain' };

export default fetchUpstream;
