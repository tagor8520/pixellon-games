/**
 * httpCache — the browser half of the caching story.
 *
 * The server layer already collapses identical requests *across users*. This
 * collapses them *within* a user's session:
 *
 *   • memory cache with a TTL → navigating Home → Deals → Home is 0 requests
 *   • single-flight → StrictMode double-mount, two components asking for the
 *     same thing, or a re-render storm all become one network call
 *   • optional persistence (sessionStorage) → a reload inside the TTL is free
 *   • stale-while-revalidate → an expired entry paints instantly and heals in
 *     the background, so the UI never shows a spinner twice for one dataset
 *   • ETag revalidation → a stale-by-TTL entry comes back as a 304 (no body)
 *
 * Everything is opt-in per request and fails safe: if storage is unavailable
 * (private mode, quota) we silently degrade to memory-only.
 */

const STORAGE_KEY = 'pixellon:httpcache:v1';
const STORAGE_BUDGET_BYTES = 512 * 1024; // keep it modest — sessionStorage is small
const inflight = new Map(); // url -> Promise
const listeners = new Map(); // url -> Set<callback>
const memory = new Map(); // url -> { data, etag, expiresAt, staleUntil }

let storageLoaded = false;

/* ── persistence ────────────────────────────────────────────────── */

function loadStorage() {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const now = Date.now();
    for (const [url, entry] of Object.entries(parsed)) {
      if (entry?.staleUntil > now) memory.set(url, entry);
    }
  } catch {
    /* storage disabled or corrupt — memory-only is fine */
  }
}

let flushTimer = 0;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = 0;
    try {
      const entries = [...memory.entries()]
        .filter(([, entry]) => entry.staleUntil > Date.now())
        .sort((a, b) => b[1].storedAt - a[1].storedAt);
      const out = {};
      let size = 0;
      for (const [url, entry] of entries) {
        const encoded = JSON.stringify(entry);
        if (size + encoded.length > STORAGE_BUDGET_BYTES) break;
        out[url] = entry;
        size += encoded.length;
      }
      globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      /* quota exceeded or no storage — ignore */
    }
  }, 400);
  flushTimer.unref?.();
}

function persist() {
  scheduleFlush();
}

/* ── pub/sub so a background refresh can repaint the page ───────── */

function notify(url, data) {
  const set = listeners.get(url);
  if (!set) return;
  for (const callback of set) {
    try {
      callback(data);
    } catch {
      /* a bad listener must not break the fetch */
    }
  }
}

/**
 * Subscribe to background refreshes for a URL.
 * @returns {() => void} unsubscribe
 */
export function subscribe(url, callback) {
  if (!listeners.has(url)) listeners.set(url, new Set());
  listeners.get(url).add(callback);
  return () => listeners.get(url)?.delete(callback);
}

/* ── the cache ──────────────────────────────────────────────────── */

export class HttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry only what is worth retrying, with jitter so a thundering herd spreads. */
function isRetryable(status) {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Cached JSON GET.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] how long the entry is fresh (default 60s)
 * @param {number} [opts.staleTtlMs] how long past that we may serve it instantly
 * @param {boolean} [opts.persist] mirror into sessionStorage
 * @param {boolean} [opts.force] bypass the cache entirely
 * @param {number} [opts.retries] extra attempts on retryable failures
 * @param {AbortSignal} [opts.signal]
 * @param {(data:any) => void} [opts.onRevalidate] called when a background refresh lands
 * @returns {Promise<any>}
 */
export async function fetchJson(
  url,
  {
    ttlMs = 60_000,
    staleTtlMs = Math.max(ttlMs * 4, 5 * 60_000),
    persist: shouldPersist = true,
    force = false,
    retries = 1,
    signal,
    onRevalidate,
  } = {},
) {
  if (shouldPersist) loadStorage();

  const entry = memory.get(url);
  const now = Date.now();

  if (!force && entry && entry.expiresAt > now) {
    // Fresh: no network at all.
    return entry.data;
  }

  if (!force && entry && entry.staleUntil > now) {
    // Stale: answer with what we have, refresh behind the user's back.
    revalidate(url, { ttlMs, staleTtlMs, persist: shouldPersist, onRevalidate });
    return entry.data;
  }

  if (inflight.has(url)) return inflight.get(url);

  const request = requestWithRetry(url, { retries, signal, ttlMs, staleTtlMs, persist: shouldPersist })
    .then(({ data, etag }) => {
      memory.set(url, {
        data,
        etag,
        storedAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        staleUntil: Date.now() + ttlMs + staleTtlMs,
      });
      if (shouldPersist) persist();
      return data;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, request);
  return request;
}

async function requestWithRetry(url, { retries, signal, ttlMs, staleTtlMs, persist: shouldPersist }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {};
      const cached = memory.get(url);
      if (cached?.etag) headers['If-None-Match'] = cached.etag;

      const response = await fetch(url, { headers, signal });

      if (response.status === 304) {
        // Nothing changed: keep the data, extend its life, cost ~0 bytes.
        if (cached) {
          const renewed = {
            ...cached,
            storedAt: Date.now(),
            expiresAt: Date.now() + ttlMs,
            staleUntil: Date.now() + ttlMs + staleTtlMs,
          };
          memory.set(url, renewed);
          if (shouldPersist) persist();
          return { data: cached.data, etag: cached.etag };
        }
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (isRetryable(response.status) && attempt < retries) {
          await sleep(250 * 2 ** attempt * (0.5 + Math.random()));
          continue;
        }
        throw new HttpError(`Request failed (${response.status})`, { status: response.status, body });
      }

      const etag = response.headers.get('etag') || undefined;
      const text = await response.text();
      return { data: text ? JSON.parse(text) : null, etag };
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') throw error;
      if (error instanceof HttpError && !isRetryable(error.status)) throw error;
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt * (0.5 + Math.random()));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/** Background refresh for a stale entry; never throws into the render path. */
function revalidate(url, { ttlMs, staleTtlMs, persist: shouldPersist, onRevalidate }) {
  if (inflight.has(url)) return;
  const callback = (data) => {
    onRevalidate?.(data);
    notify(url, data);
  };
  const promise = requestWithRetry(url, { retries: 1, ttlMs, staleTtlMs, persist: shouldPersist })
    .then(({ data, etag }) => {
      memory.set(url, {
        data,
        etag,
        storedAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        staleUntil: Date.now() + ttlMs + staleTtlMs,
      });
      if (shouldPersist) persist();
      callback(data);
    })
    .catch(() => {
      // Upstream is down: keep serving the stale copy rather than blanking the UI.
      const entry = memory.get(url);
      if (entry) {
        entry.expiresAt = Date.now() + 30_000;
        entry.staleUntil = Date.now() + Math.max(staleTtlMs, 30_000);
      }
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, promise);
}

/* ── introspection helpers (used by the debug overlay + docs) ───── */

export function cacheInfo() {
  const now = Date.now();
  let fresh = 0;
  let stale = 0;
  for (const entry of memory.values()) {
    if (entry.expiresAt > now) fresh++;
    else if (entry.staleUntil > now) stale++;
  }
  return { entries: memory.size, fresh, stale, inflight: inflight.size };
}

export function clearHttpCache() {
  memory.clear();
  inflight.clear();
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Build a stable URL for a route + params (the cache key). */
export function apiUrl(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export default { fetchJson, subscribe, cacheInfo, clearHttpCache, apiUrl };
