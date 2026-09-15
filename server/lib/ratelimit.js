/**
 * Fixed-window rate limiter — a seatbelt for the shared upstream keys.
 *
 * The API layer holds ONE RAWG / Twitch / Steam key for the whole site. If a
 * scraper or a buggy client starts hammering `/api/games/search`, the daily
 * quota dies for everybody. The limiter is intentionally in-process and cheap:
 * a per-IP counter in a Map, with periodic sweeping.
 *
 * It is a *protection*, not a security boundary — behind a CDN you should also
 * enable the platform's own rate limiting, and front the API with the CDN cache
 * so most requests never reach this code at all.
 */

export function createRateLimiter({
  limit = 120,
  windowMs = 60_000,
  maxKeys = 10_000,
  log = () => {},
} = {}) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const buckets = new Map();
  let blocked = 0;

  const sweep = (now) => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size > maxKeys) {
      // Under a flood: drop the oldest half rather than growing without bound.
      let toDrop = Math.floor(maxKeys / 2);
      for (const key of buckets.keys()) {
        buckets.delete(key);
        if (--toDrop <= 0) break;
      }
      log('ratelimit: bucket overflow, dropped oldest entries');
    }
  };

  return {
    /**
     * @param {string} key client identity (IP + route class)
     * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
     */
    check(key) {
      const t = Date.now();
      if (buckets.size > maxKeys / 2) sweep(t);

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= t) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
      }
      bucket.count++;
      if (bucket.count > limit) {
        blocked++;
        return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
      }
      return { allowed: true, remaining: limit - bucket.count, retryAfterSec: Math.ceil((bucket.resetAt - t) / 1000) };
    },
    stats: () => ({ keys: buckets.size, limit, windowMs, blocked }),
    reset: () => buckets.clear(),
  };
}

export default createRateLimiter;
