/**
 * TtlCache — dependency-free cache used by every API route.
 *
 * It exists to convert "one upstream request per user per page view" into
 * "one upstream request per TTL window per process". That single change is what
 * protects a shared API key's quota (RAWG, Twitch, IGDB all rate-limit per key)
 * and removes upstream latency from the critical path.
 *
 * Features
 *   • TTL per entry, plus an optional *stale* window for serve-stale-while-revalidate
 *   • single-flight — N concurrent misses for one key run the loader once
 *   • LRU eviction by entry count + periodic pruning of dead entries
 *   • in-flight errors are never cached (only successes and explicit negatives)
 *   • counters so `/api/health` can report the real hit rate
 */

const now = () => Date.now();

export class TtlCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxEntries] hard cap on live entries (LRU evicted)
   * @param {number} [opts.defaultTtlMs] used when a caller omits a TTL
   * @param {(msg: string, meta?: object) => void} [opts.log]
   */
  constructor({ maxEntries = 1000, defaultTtlMs = 60_000, log = () => {} } = {}) {
    /** @type {Map<string, {value: any, storedAt: number, freshUntil: number, staleUntil: number}>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.inflight = new Map();
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.log = log;
    this.counters = { hit: 0, stale: 0, miss: 0, coalesced: 0, error: 0, evicted: 0, refreshes: 0 };
    this._lastPrune = now();
  }

  size() {
    return this.entries.size;
  }

  /** Current entry without touching freshness bookkeeping. */
  peek(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.staleUntil <= now()) {
      this.entries.delete(key);
      return undefined;
    }
    // LRU touch: re-insert so the most recently used key is last.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key, value, ttlMs = this.defaultTtlMs, staleTtlMs = 0) {
    const t = now();
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      storedAt: t,
      freshUntil: t + ttlMs,
      staleUntil: t + ttlMs + staleTtlMs,
    });
    this._evict();
    return value;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  /**
   * Read-through cache with single-flight + stale-while-revalidate.
   *
   * @template T
   * @param {string} key
   * @param {{ ttlMs?: number, staleTtlMs?: number, loader: () => Promise<T> }} opts
   * @returns {Promise<{ value: T, state: 'fresh'|'stale'|'miss'|'coalesced' }>}
   */
  async load(key, { ttlMs = this.defaultTtlMs, staleTtlMs = 0, loader }) {
    const entry = this.peek(key);

    if (entry && entry.freshUntil > now()) {
      this.counters.hit++;
      return { value: entry.value, state: 'fresh' };
    }

    // Someone is already fetching this key — join them instead of duplicating work.
    const pending = this.inflight.get(key);
    if (pending) {
      this.counters.coalesced++;
      return { value: await pending, state: 'coalesced' };
    }

    if (entry) {
      // Expired but still inside its grace window: answer instantly and heal in
      // the background. Users never wait on a slow upstream twice.
      this.counters.stale++;
      this._refresh(key, loader, ttlMs, staleTtlMs);
      return { value: entry.value, state: 'stale' };
    }

    this.counters.miss++;
    // `Promise.resolve` so a handler may return a plain value (e.g. an empty
    // list for a too-short search query) without special-casing here.
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.set(key, value, ttlMs, staleTtlMs);
        return value;
      })
      .catch((error) => {
        this.counters.error++;
        // Never poison the cache with a failure. If we have a dead-but-unexpired
        // entry we keep serving it, which is why staleTtlMs exists.
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return { value: await promise, state: 'miss' };
  }

  /** Fire-and-forget background revalidation for a stale entry. */
  _refresh(key, loader, ttlMs, staleTtlMs) {
    if (this.inflight.has(key)) return;
    this.counters.refreshes++;
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => this.set(key, value, ttlMs, staleTtlMs))
      .catch((error) => {
        this.counters.error++;
        this.log('cache: revalidation failed', { key, error: String(error?.message || error) });
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
  }

  _evict() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
      this.counters.evicted++;
    }
  }

  /** Drop entries that are past their stale window. Cheap: called opportunistically. */
  prune() {
    const t = now();
    this._lastPrune = t;
    for (const [key, entry] of this.entries) {
      if (entry.staleUntil <= t) this.entries.delete(key);
    }
  }

  stats() {
    const { hit, stale, miss, coalesced, error, evicted, refreshes } = this.counters;
    const served = hit + stale + coalesced;
    const lookups = served + miss;
    const upstreamCalls = miss + refreshes;
    return {
      entries: this.entries.size,
      inflight: this.inflight.size,
      maxEntries: this.maxEntries,
      hitRate: lookups ? +(served / lookups).toFixed(3) : 0,
      savedUpstreamCalls: Math.max(0, lookups - upstreamCalls),
      counters: { hit, stale, miss, coalesced, error, evicted, refreshes },
    };
  }

  resetStats() {
    for (const key of Object.keys(this.counters)) this.counters[key] = 0;
  }
}

/**
 * Build a stable cache key from a route name + normalised params.
 * Params are sorted so `?a=1&b=2` and `?b=2&a=1` share an entry.
 */
export function cacheKey(route, params = {}) {
  const parts = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${String(params[k]).toLowerCase()}`);
  return parts.length ? `${route}?${parts.join('&')}` : route;
}

export default TtlCache;
