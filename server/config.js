/**
 * API policy in one place: upstream hosts, cache lifetimes and response shapes.
 *
 * Cache lifetimes are a *cost* decision, not a technical one. Each TTL is the
 * answer to "how stale can this be before a user notices?" — every second of
 * TTL is upstream quota, money and latency we do not spend. The `swr` value is
 * how long after that we may keep serving the stale copy while refreshing in
 * the background (users never wait for the refresh).
 */

const SEC = 1000; // ms per second — TTLs below are written as `<minutes|hours> * 60 * SEC`

/** Upstream bases — overridable so tests (and self-hosters) can point elsewhere. */
export function upstreams(env = {}) {
  const pick = (key, fallback) => (env[key] && String(env[key]).trim()) || fallback;
  return {
    rawg: pick('RAWG_API_BASE', 'https://api.rawg.io/api'),
    steamStore: pick('STEAM_STORE_BASE', 'https://store.steampowered.com/api'),
    steamApi: pick('STEAM_API_BASE', 'https://api.steampowered.com'),
    igdb: pick('IGDB_BASE', 'https://api.igdb.com/v4'),
    twitch: pick('TWITCH_BASE', 'https://api.twitch.tv/helix'),
    pandascore: pick('PANDASCORE_BASE', 'https://api.pandascore.co'),
    cheapshark: pick('CHEAPSHARK_BASE', 'https://www.cheapshark.com/api/1.0'),
    freetogame: pick('FREETOGAME_BASE', 'https://www.freetogame.com/api'),
    rss2json: pick('RSS2JSON_BASE', 'https://api.rss2json.com/v1/api.json'),
    steamspy: pick('STEAMSPY_BASE', 'https://steamspy.com/api.php'),
    newsFeed: pick('NEWS_FEED_URL', 'https://feeds.feedburner.com/ign/news'),
  };
}

/**
 * Per-route cache policy.
 * `browser` is capped at 5 min by default (short, so a redeploy is picked up),
 * while `s-maxage` (the CDN) can be long — that split is what makes a small
 * origin survive a traffic spike.
 */
export const ROUTE_POLICY = {
  home: { ttl: 10 * 60 * SEC, swr: 60 * 60 * SEC },
  trending: { ttl: 10 * 60 * SEC, swr: 60 * 60 * SEC },
  topRated: { ttl: 6 * 60 * 60 * SEC, swr: 24 * 60 * 60 * SEC, browser: 15 * 60 * SEC },
  upcoming: { ttl: 3 * 60 * 60 * SEC, swr: 12 * 60 * 60 * SEC, browser: 15 * 60 * SEC },
  indie: { ttl: 6 * 60 * 60 * SEC, swr: 24 * 60 * 60 * SEC, browser: 15 * 60 * SEC },
  allTime: { ttl: 24 * 60 * 60 * SEC, swr: 7 * 24 * 60 * 60 * SEC, browser: 30 * 60 * SEC },
  byGenre: { ttl: 6 * 60 * 60 * SEC, swr: 24 * 60 * 60 * SEC, browser: 15 * 60 * SEC },
  search: { ttl: 30 * 60 * SEC, swr: 2 * 60 * 60 * SEC },
  details: { ttl: 24 * 60 * 60 * SEC, swr: 7 * 24 * 60 * 60 * SEC, browser: 30 * 60 * SEC },
  wiki: { ttl: 24 * 60 * 60 * SEC, swr: 7 * 24 * 60 * 60 * SEC, browser: 30 * 60 * SEC },
  steamApp: { ttl: 6 * 60 * 60 * SEC, swr: 24 * 60 * 60 * SEC, browser: 30 * 60 * SEC },
  steamPlayer: { ttl: 5 * 60 * SEC, swr: 30 * 60 * SEC, browser: 60 * SEC },
  steamspy: { ttl: 24 * 60 * 60 * SEC, swr: 7 * 24 * 60 * 60 * SEC, browser: 30 * 60 * SEC },
  igdb: { ttl: 24 * 60 * 60 * SEC, swr: 7 * 24 * 60 * 60 * SEC, browser: 30 * 60 * SEC },
  deals: { ttl: 10 * 60 * SEC, swr: 60 * 60 * SEC },
  freeGames: { ttl: 30 * 60 * SEC, swr: 2 * 60 * 60 * SEC },
  news: { ttl: 10 * 60 * SEC, swr: 60 * 60 * SEC },
  streams: { ttl: 2 * 60 * SEC, swr: 10 * 60 * SEC, browser: 30 * SEC },
  esports: { ttl: 5 * 60 * SEC, swr: 30 * 60 * SEC, browser: 60 * SEC },
};

/** How long a 404 from an upstream is remembered, to stop hammering dead ids. */
export const NEGATIVE_TTL_MS = 60_000;

/** Hard caps that stop a client from asking upstream for huge payloads. */
export const LIMITS = {
  listPageSize: 40,
  searchPageSize: 10,
  searchQueryLength: 80,
  dealsCount: 60,
  streamsCount: 40,
  esportsCount: 25,
  newsCount: 40,
  wikiTags: 6,
  descriptionChars: 40_000,
  newsSummaryChars: 320,
};

export default { upstreams, ROUTE_POLICY, LIMITS, NEGATIVE_TTL_MS };
