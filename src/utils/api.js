/**
 * Data access layer.
 *
 * ⚠️ This file used to talk to six third-party APIs directly from the browser
 * and sign RAWG requests with `import.meta.env.VITE_RAWG_API_KEY` — which Vite
 * inlines into the public bundle, so the key was readable by anyone. It was
 * also committed in `.env`.
 *
 * Now every call goes same-origin to `/api/*` (see `server/routes.js`), where:
 *   • credentials live only in server env
 *   • responses are projected, cached and CDN-cached
 *   • composites turn 5–6 browser requests into 1
 *
 * Client-side TTLs mirror the server policy so a navigation is free, and stale
 * entries are served instantly while refreshing in the background.
 */

import { fetchJson, apiUrl } from './httpCache.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const TTL = {
  home: 10 * MINUTE,
  list: 30 * MINUTE,
  details: 4 * HOUR,
  steam: 6 * HOUR,
  live: 2 * MINUTE,
  deals: 10 * MINUTE,
  news: 10 * MINUTE,
  player: 2 * MINUTE,
};

/* ── catalog ────────────────────────────────────────────────────── */

/**
 * Offline / degraded fallback.
 *
 * A missing key, an upstream outage, an expired quota or a flaky connection
 * should not produce an empty homepage — and a visitor on a train should still
 * see the site. `src/data/mockData.js` is imported lazily, so this resilience
 * costs *zero* bytes on the happy path and only loads when a catalog request
 * has already failed. Anything user-specific (profiles, wiki bundles) still
 * fails honestly, because a stale answer there would be a lie.
 */
async function withFallback(request, pick, { emptyIsFailure = false } = {}) {
  const degraded = async (reason) => {
    if (import.meta.env.DEV) console.warn('[api] serving local sample data:', reason);
    const sample = await import('../data/mockData.js');
    return pick(sample);
  };

  try {
    const result = await request();
    // A 200 with an empty catalog is still a broken experience: the upstream key
    // may be out of quota, or the box may be offline behind a caching proxy.
    if (emptyIsFailure) {
      const empty = Array.isArray(result) ? result.length === 0 : isEmptyBundle(result);
      if (empty) return degraded('empty response');
    }
    return result;
  } catch (error) {
    return degraded(error?.message || 'request failed');
  }
}

const isEmptyBundle = (bundle) =>
  !!bundle &&
  ['trending', 'topRated', 'upcoming'].every((key) => !bundle[key] || bundle[key].length === 0)

export const getTrendingGames = () =>
  withFallback(
    () => fetchJson(apiUrl('/api/games/trending'), { ttlMs: TTL.list, persist: true }),
    (sample) => sample.trendingGames,
    { emptyIsFailure: true },
  );

export const getHighlyRatedGames = () =>
  withFallback(
    () => fetchJson(apiUrl('/api/games/top-rated'), { ttlMs: TTL.list, persist: true }),
    (sample) => sample.recentReviews,
    { emptyIsFailure: true },
  );

export const getUpcomingGames = () =>
  withFallback(
    () => fetchJson(apiUrl('/api/games/upcoming'), { ttlMs: TTL.list, persist: true }),
    (sample) => sample.upcomingReleases,
    { emptyIsFailure: true },
  );

export const getIndieGames = () =>
  withFallback(
    () => fetchJson(apiUrl('/api/games/indie'), { ttlMs: TTL.list, persist: true }),
    (sample) => sample.indieGames,
    { emptyIsFailure: true },
  );

export const getAllTimeTopGames = () =>
  fetchJson(apiUrl('/api/games/all-time'), { ttlMs: TTL.list, persist: true });

export const getGamesByGenre = (genreSlug, limit = 6) =>
  fetchJson(apiUrl('/api/games/by-genre', { genre: genreSlug, limit }), {
    ttlMs: TTL.list,
    persist: true,
  });

export const searchGames = (query, { signal, limit = 5 } = {}) =>
  fetchJson(apiUrl('/api/games/search', { q: query.trim(), limit }), {
    ttlMs: 30 * MINUTE,
    signal,
    // Search results are query-shaped; keeping them out of sessionStorage keeps
    // our storage budget for catalog data.
    persist: false,
  });

/** One request that feeds the whole home page (3 upstream calls, cached together). */
export const getHomeBundle = () =>
  withFallback(
    () => fetchJson(apiUrl('/api/home'), { ttlMs: TTL.home, persist: true }),
    (sample) => ({
      trending: sample.trendingGames,
      topRated: sample.recentReviews,
      upcoming: sample.upcomingReleases,
      degraded: true,
    }),
    { emptyIsFailure: true },
  );

/** One request that feeds a whole Codex page: details + Steam + IGDB. */
export const getWikiBundle = (gameId, { onRevalidate } = {}) =>
  fetchJson(apiUrl(`/api/wiki/${gameId}`), {
    ttlMs: TTL.details,
    persist: true,
    onRevalidate,
  });

export const getGameDetails = (gameId) =>
  fetchJson(apiUrl(`/api/games/${gameId}`), { ttlMs: TTL.details, persist: true });

/* ── steam / igdb ───────────────────────────────────────────────── */

export const getSteamDetails = (appId) =>
  fetchJson(apiUrl(`/api/steam/app/${appId}`), { ttlMs: TTL.steam, persist: true });

export const getSteamPlayer = (steamId) =>
  fetchJson(apiUrl(`/api/steam/player/${steamId}`), { ttlMs: TTL.player, persist: true });

export const getSteamProfile = async (steamId) => (await getSteamPlayer(steamId))?.profile ?? null;

export const getSteamOwnedGames = async (steamId) => (await getSteamPlayer(steamId))?.games ?? [];

export const getSteamSpy = (appId) =>
  fetchJson(apiUrl(`/api/steamspy/app/${appId}`), { ttlMs: 6 * HOUR, persist: true });

export const getIGDBDetails = (gameName) =>
  fetchJson(apiUrl('/api/igdb/search', { name: gameName }), { ttlMs: 24 * HOUR, persist: true });

/* ── feeds ──────────────────────────────────────────────────────── */

export const getDeals = () => fetchJson(apiUrl('/api/deals'), { ttlMs: TTL.deals, persist: true });

export const getFreeGames = (platform = 'all') =>
  fetchJson(apiUrl('/api/free-games', { platform }), { ttlMs: 30 * MINUTE, persist: true });

export const getGamingNews = () => fetchJson(apiUrl('/api/news'), { ttlMs: TTL.news, persist: true });

export const getTopStreams = (gameName = '') =>
  fetchJson(apiUrl('/api/streams', { game: gameName }), { ttlMs: TTL.live, persist: false });

export const getEsportsMatches = () =>
  fetchJson(apiUrl('/api/esports'), { ttlMs: 5 * MINUTE, persist: true });

/** Diagnostics used by the debug overlay / docs; safe in production. */
export const getApiHealth = () => fetchJson(apiUrl('/api/health'), { ttlMs: 0, force: true, persist: false });
