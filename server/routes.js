/**
 * API routes.
 *
 * Every third-party call the site makes lives here, behind a whitelisted,
 * cacheable, same-origin endpoint. Three deliberate design choices:
 *
 * 1. NAMED ENDPOINTS, NOT A GENERIC PROXY.
 *    The old code let the browser build RAWG URLs and sign them with our key.
 *    Here the server owns the query strings, so a client can only ever ask for
 *    the exact shapes the UI needs — the shared key cannot be used as a free
 *    scraping proxy.
 *
 * 2. PROJECTION.
 *    Upstream payloads are huge (a RAWG list page is ~200 KB of fields we never
 *    render). Handlers return only what the components use, which cuts bytes on
 *    every request *and* shrinks what the CDN has to store and revalidate.
 *
 * 3. COMPOSITES.
 *    A Codex/wiki page used to fire 5–6 requests from the browser (details →
 *    stores → steam details, IGDB, Twitch). Now it is one `/api/wiki/:id`
 *    request: one cache entry, one round trip, one thing that can fail.
 *
 * Handlers are cache-agnostic: the router wraps them in TtlCache + CDN headers.
 */

import { fetchUpstream, UpstreamError } from './lib/upstream.js';
import { hasCredential } from './lib/env.js';
import { ROUTE_POLICY, LIMITS, upstreams } from './config.js';

/* ── small shared helpers ───────────────────────────────────────── */

const trim = (value, max = 400) => (typeof value === 'string' ? value.slice(0, max) : undefined);

/** Strip any HTML — the news feed is the one place we render remote markup. */
const stripHtml = (html = '') =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** RAWG's image CDN accepts width hints — ask for the size the card renders. */
export const rawgImage = (url, width = 640) => {
  if (!url) return undefined;
  if (!/media\.rawg\.io/.test(url)) return url;
  return `${url}?w=${width}&q=70`;
};

function requireKey(env, name, route) {
  const value = env[name];
  if (!hasCredential(value)) {
    throw Object.assign(new UpstreamError(`${name} is not configured`, { status: 503 }), {
      code: 'missing_credentials',
      route,
    });
  }
  return value;
}

/* ── RAWG ───────────────────────────────────────────────────────── */

/** RAWG list item → the ~10 fields our cards actually render. */
function projectRawgGame(game, { imageWidth = 640 } = {}) {
  return {
    id: game.id,
    title: game.name,
    genre: game.genres?.[0]?.name || 'Action',
    platform: game.parent_platforms?.map((p) => p.platform.name).slice(0, 3) || ['PC'],
    rating: game.metacritic ? (game.metacritic / 10).toFixed(1) : null,
    metacritic: game.metacritic ?? null,
    image: rawgImage(game.background_image, imageWidth),
    excerpt: trim(game.name, 120),
    date: game.released || null,
    developer: game.developers?.[0]?.name,
  };
}

function rawgFetch(env, path, params, { signal, log } = {}) {
  const key = requireKey(env, 'RAWG_API_KEY', path);
  const base = upstreams(env).rawg;
  const search = new URLSearchParams({ key, ...params });
  return fetchUpstream(`${base}${path}?${search}`, { signal, log });
}

/**
 * RAWG list → projected cards, hard-capped at the requested page size.
 * The cap matters: pathologically large upstream pages would otherwise blow up
 * our cache entries, our CDN storage and the client's parse time.
 */
const rawgList = (env, params, opts = {}) =>
  rawgFetch(env, '/games', params, opts).then((data) =>
    (data?.results || [])
      .slice(0, params.page_size || LIMITS.listPageSize)
      .map((game) => projectRawgGame(game, opts)),
  );

const today = () => new Date().toISOString().slice(0, 10);
const shiftDate = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/* ── response projections for the other providers ────────────────── */

const projectStream = (s) => ({
  id: s.id,
  user_name: s.user_name,
  title: trim(s.title, 140),
  viewer_count: s.viewer_count,
  game_name: s.game_name,
  thumbnail_url: s.thumbnail_url,
  url: `https://twitch.tv/${s.user_login || s.user_name}`,
  started_at: s.started_at,
  language: s.language,
});

const projectDeal = (d) => ({
  title: d.title,
  salePrice: d.salePrice,
  normalPrice: d.normalPrice,
  savings: d.savings,
  dealID: d.dealID,
  thumb: d.thumb,
  storeID: d.storeID,
  metacriticScore: d.metacriticScore,
  steamRatingPercent: d.steamRatingPercent,
});

const projectFreeGame = (g) => ({
  id: g.id,
  title: g.title,
  thumbnail: g.thumbnail,
  short_description: trim(g.short_description, 220),
  genre: g.genre,
  platform: g.platform,
  publisher: g.publisher,
  game_url: g.game_url,
  release_date: g.release_date,
});

const projectMatch = (m) => ({
  id: m.id,
  name: m.name,
  begin_at: m.begin_at,
  scheduled_at: m.scheduled_at,
  status: m.status,
  league: m.league ? { name: m.league.name, image_url: m.league.image_url } : null,
  serie: m.serie ? { name: m.serie.name } : null,
  tournament: m.tournament ? { name: m.tournament.name } : null,
  opponents: (m.opponents || []).map((o) => ({
    name: o.opponent?.name,
    image_url: o.opponent?.image_url,
  })),
  streams: (m.streams_list || [])
    .filter((s) => s.main)
    .map((s) => ({ raw_url: s.raw_url, language: s.language })),
});

const projectNews = (item) => ({
  title: trim(item.title, 180),
  link: item.link,
  guid: item.guid,
  pubDate: item.pubDate,
  author: trim(item.author, 80),
  // Rendered with dangerouslySetInnerHTML today, so tags are stripped here —
  // smaller payload AND no remote markup executing in our origin.
  description: trim(stripHtml(item.description), LIMITS.newsSummaryChars),
  thumbnail: item.thumbnail || item.enclosure?.link,
});

function projectIgdb(data) {
  if (!data) return null;
  return {
    name: data.name,
    storyline: trim(data.storyline, 2000),
    summary: trim(data.summary, 2000),
    cover: data.cover?.url ? { url: `https:${data.cover.url}`.replace('t_thumb', 't_cover_big') } : null,
    involved_companies: (data.involved_companies || [])
      .slice(0, 6)
      .map((c) => ({ company: { name: c.company?.name } })),
  };
}

/* ── route table ────────────────────────────────────────────────── */

/**
 * @param {{ env: Record<string, string>, log: Function }} ctx
 * @returns {Array<object>} routes
 */
export function createRoutes({ env, log }) {
  const U = upstreams(env);
  const policy = (name) => ROUTE_POLICY[name] || { ttl: 60_000, swr: 0 };
  const opt = (name, extra = {}) => ({ ...policy(name), ...extra });

  /** @type {Array<{name: string, method: string, match: (p: string) => any, policy: object, handler: Function}>} */
  const routes = [
    {
      name: 'health',
      method: 'GET',
      match: (p) => (p === '/api/health' ? {} : null),
      policy: { ttl: 0, swr: 0 },
      handler: async ({ runtime }) => ({
        ok: true,
        now: new Date().toISOString(),
        cache: runtime.cache.stats(),
        rateLimit: runtime.limiter.stats(),
        credentials: buildCredentialReport(env),
        routes: routes.map((r) => ({ name: r.name, ttlMs: r.policy.ttl, swrMs: r.policy.swr })),
      }),
    },

    /* ── home: three upstream calls, ONE client request ─────────── */
    {
      name: 'home',
      method: 'GET',
      match: (p) => (p === '/api/home' ? {} : null),
      policy: opt('home'),
      handler: async (ctx) => {
        const [trending, topRated, upcoming] = await Promise.allSettled([
          rawgList(env, { dates: `${shiftDate(-180)},${today()}`, ordering: '-added', page_size: 3 }, ctx),
          rawgList(
            env,
            { dates: `${new Date().getFullYear()}-01-01,${new Date().getFullYear()}-12-31`, ordering: '-metacritic', page_size: 4 },
            ctx,
          ),
          rawgList(env, { dates: `${today()},${shiftDate(730)}`, ordering: 'released', page_size: 12 }, ctx),
        ]);
        return {
          trending: settled(trending, ctx.log, 'home.trending'),
          topRated: settled(topRated, ctx.log, 'home.topRated'),
          upcoming: settled(upcoming, ctx.log, 'home.upcoming'),
        };
      },
    },

    {
      name: 'trending',
      method: 'GET',
      match: (p) => (p === '/api/games/trending' ? {} : null),
      policy: opt('trending'),
      handler: (ctx) =>
        rawgList(env, { dates: `${shiftDate(-180)},${today()}`, ordering: '-added', page_size: 12 }, ctx),
    },
    {
      name: 'topRated',
      method: 'GET',
      match: (p) => (p === '/api/games/top-rated' ? {} : null),
      policy: opt('topRated'),
      handler: (ctx) =>
        rawgList(
          env,
          {
            dates: `${new Date().getFullYear()}-01-01,${new Date().getFullYear()}-12-31`,
            ordering: '-metacritic',
            page_size: 12,
          },
          ctx,
        ),
    },
    {
      name: 'allTime',
      method: 'GET',
      match: (p) => (p === '/api/games/all-time' ? {} : null),
      policy: opt('allTime'),
      handler: (ctx) => rawgList(env, { ordering: '-metacritic', page_size: LIMITS.listPageSize }, ctx),
    },
    {
      name: 'upcoming',
      method: 'GET',
      match: (p) => (p === '/api/games/upcoming' ? {} : null),
      policy: opt('upcoming'),
      validate: { page: { type: 'int', min: 1, max: 3, default: 1 }, limit: { type: 'int', min: 10, max: LIMITS.listPageSize, default: 20 } },
      handler: (ctx, { limit }) =>
        rawgList(
          env,
          { dates: `${today()},${shiftDate(730)}`, ordering: 'released', page_size: limit },
          ctx,
        ),
    },
    {
      name: 'indie',
      method: 'GET',
      match: (p) => (p === '/api/games/indie' ? {} : null),
      policy: opt('indie'),
      handler: (ctx) => rawgList(env, { genres: 'indie', ordering: '-rating', page_size: 12 }, ctx),
    },
    {
      name: 'byGenre',
      method: 'GET',
      match: (p) => (p === '/api/games/by-genre' ? {} : null),
      policy: opt('byGenre'),
      // Only our own four category slugs are accepted — no arbitrary genre scans.
      validate: {
        genre: { pattern: /^(role-playing-games-rpg|action|shooter|strategy|indie|adventure|puzzle)$/ },
        limit: { type: 'int', min: 3, max: LIMITS.listPageSize, default: 6 },
      },
      handler: (ctx, { genre, limit }) =>
        rawgList(env, { genres: genre, ordering: '-rating', page_size: limit }, ctx),
    },
    {
      name: 'search',
      method: 'GET',
      match: (p) => (p === '/api/games/search' ? {} : null),
      policy: opt('search'),
      validate: { q: { maxLength: LIMITS.searchQueryLength, default: '' }, limit: { type: 'int', min: 1, max: LIMITS.searchPageSize, default: 5 } },
      handler: (ctx, { q, limit }) => {
        if (!q || q.trim().length < 2) return [];
        return rawgList(env, { search: q.trim(), page_size: limit }, ctx).then((items) =>
          items.map((item) => ({ ...item, excerpt: item.title })),
        );
      },
    },

    /* ── game details (single, projected) ───────────────────────── */
    {
      name: 'details',
      method: 'GET',
      match: (p) => {
        const m = /^\/api\/games\/(\d{1,9})$/.exec(p);
        return m ? { id: m[1] } : null;
      },
      policy: opt('details'),
      handler: (ctx, { id }) => rawgFetch(env, `/games/${id}`, {}, ctx).then((g) => projectRawgDetails(g)),
    },

    /* ── THE COMPOSITE: one request instead of five ─────────────── */
    {
      name: 'wiki',
      method: 'GET',
      match: (p) => {
        const m = /^\/api\/wiki\/(\d{1,9})$/.exec(p);
        return m ? { id: m[1] } : null;
      },
      policy: opt('wiki'),
      handler: async (ctx, { id }) => {
        const details = await rawgFetch(env, `/games/${id}`, {}, ctx);
        if (!details?.id) throw new UpstreamError('game not found', { status: 404 });

        // The secondary sources are optional: a missing Twitch/Steam key must
        // degrade the page, not break it.
        const [storesResult, igdbResult] = await Promise.allSettled([
          rawgFetch(env, `/games/${id}/stores`, {}, ctx),
          igdbSearch(details.name, ctx),
        ]);

        const stores = storesResult.status === 'fulfilled' ? storesResult.value : null;
        const igdb = igdbResult.status === 'fulfilled' ? projectIgdb(igdbResult.value) : null;

        const steamStore = stores?.results?.find((s) => s.store_id === 1);
        const steamAppId = steamStore?.url?.match(/app\/(\d+)/)?.[1] || null;

        const steam = steamAppId ? await steamAppDetails(steamAppId, ctx).catch(() => null) : null;

        return {
          ...projectRawgDetails(details),
          steamAppId,
          steam: steam ? projectSteamApp(steam) : null,
          igdb,
        };
      },
    },

    /* ── Steam ──────────────────────────────────────────────────── */
    {
      name: 'steamApp',
      method: 'GET',
      match: (p) => {
        const m = /^\/api\/steam\/app\/(\d{1,12})$/.exec(p);
        return m ? { appId: m[1] } : null;
      },
      policy: opt('steamApp'),
      handler: (ctx, { appId }) => steamAppDetails(appId, ctx).then(projectSteamApp),
    },
    {
      name: 'steamPlayer',
      method: 'GET',
      match: (p) => {
        const m = /^\/api\/steam\/player\/(\d{17})$/.exec(p);
        return m ? { steamId: m[1] } : null;
      },
      policy: opt('steamPlayer'),
      handler: async (ctx, { steamId }) => {
        const key = requireKey(env, 'STEAM_WEB_API_KEY', 'steamPlayer');
        const [summary, owned] = await Promise.allSettled([
          fetchUpstream(`${U.steamApi}/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`, ctx),
          fetchUpstream(
            `${U.steamApi}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`,
            ctx,
          ),
        ]);
        const profile = summary.status === 'fulfilled' ? summary.value?.response?.players?.[0] || null : null;
        if (!profile) throw new UpstreamError('steam profile not found', { status: 404 });
        const games = (owned.status === 'fulfilled' ? owned.value?.response?.games || [] : [])
          // The UI shows the top 12; sending 300 rows wastes ~90% of the bytes.
          .slice()
          .sort((a, b) => b.playtime_forever - a.playtime_forever)
          .slice(0, 24)
          .map((g) => ({
            appid: g.appid,
            name: g.name,
            playtime_forever: g.playtime_forever,
            img_icon_url: g.img_icon_url,
          }));
        return { profile, games };
      },
    },
    {
      name: 'steamspy',
      method: 'GET',
      match: (p) => {
        const m = /^\/api\/steamspy\/app\/(\d{1,12})$/.exec(p);
        return m ? { appId: m[1] } : null;
      },
      policy: opt('steamspy'),
      handler: (ctx, { appId }) =>
        fetchUpstream(`${U.steamspy}?request=appdetails&appid=${appId}`, ctx).then((d) => ({
          owners: d?.owners,
          positive: d?.positive,
          negative: d?.negative,
          average_forever: d?.average_forever,
          ccu: d?.ccu,
          price: d?.price,
          tags: Object.keys(d?.tags || {}).slice(0, 8),
        })),
    },

    /* ── IGDB ───────────────────────────────────────────────────── */
    {
      name: 'igdb',
      method: 'GET',
      match: (p) => (p === '/api/igdb/search' ? {} : null),
      policy: opt('igdb'),
      validate: { name: { maxLength: LIMITS.searchQueryLength } },
      handler: (ctx, { name }) => igdbSearch(name, ctx).then(projectIgdb),
    },

    /* ── Everything else (no keys needed) ───────────────────────── */
    {
      name: 'deals',
      method: 'GET',
      match: (p) => (p === '/api/deals' ? {} : null),
      policy: opt('deals'),
      handler: (ctx) =>
        fetchUpstream(`${U.cheapshark}/deals?storeID=1&sortBy=DealRating`, ctx).then((d) =>
          (Array.isArray(d) ? d : []).slice(0, LIMITS.dealsCount).map(projectDeal),
        ),
    },
    {
      name: 'freeGames',
      method: 'GET',
      match: (p) => (p === '/api/free-games' ? {} : null),
      policy: opt('freeGames'),
      validate: { platform: { pattern: /^(all|pc|browser)$/, default: 'all' } },
      handler: (ctx, { platform }) =>
        fetchUpstream(`${U.freetogame}/games?platform=${platform}`, ctx).then((d) =>
          (Array.isArray(d) ? d : []).map(projectFreeGame),
        ),
    },
    {
      name: 'news',
      method: 'GET',
      match: (p) => (p === '/api/news' ? {} : null),
      policy: opt('news'),
      handler: (ctx) =>
        fetchUpstream(`${U.rss2json}?rss_url=${encodeURIComponent(U.newsFeed)}&count=${LIMITS.newsCount}`, ctx).then(
          (d) => (d?.items || []).slice(0, LIMITS.newsCount).map(projectNews),
        ),
    },
    {
      name: 'streams',
      method: 'GET',
      match: (p) => (p === '/api/streams' ? {} : null),
      policy: opt('streams'),
      validate: { game: { maxLength: 80, default: '' } },
      handler: async (ctx, { game }) => {
        if (!hasCredential(env.TWITCH_CLIENT_ID) || !hasCredential(env.TWITCH_APP_TOKEN)) return [];
        const headers = {
          'Client-ID': env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${env.TWITCH_APP_TOKEN}`,
        };
        let url = `${U.twitch}/streams?first=${LIMITS.streamsCount}`;
        if (game) {
          const found = await fetchUpstream(
            `${U.twitch}/games?name=${encodeURIComponent(game)}`,
            { headers, ...ctx },
          ).catch(() => null);
          const gameId = found?.data?.[0]?.id;
          if (gameId) url += `&game_id=${gameId}`;
        }
        const data = await fetchUpstream(url, { headers, ...ctx });
        return (data?.data || []).map(projectStream);
      },
    },
    {
      name: 'esports',
      method: 'GET',
      match: (p) => (p === '/api/esports' ? {} : null),
      policy: opt('esports'),
      handler: (ctx) => {
        if (!hasCredential(env.PANDASCORE_API_KEY)) return [];
        return fetchUpstream(
          `${U.pandascore}/matches/upcoming?sort=begin_at&per_page=${LIMITS.esportsCount}`,
          { headers: { Authorization: `Bearer ${env.PANDASCORE_API_KEY}` }, ...ctx },
        ).then((d) => (Array.isArray(d) ? d : []).map(projectMatch));
      },
    },

    /* ── OSM chunk proxy (free, no key) ─────────────────────────── */
    {
      name: 'osmChunk',
      method: 'GET',
      match: (p) => (p === '/api/osm/chunk' ? {} : null),
      policy: opt('osmChunk'),
      validate: {
        lat: { type: 'number', min: -85, max: 85 },
        lon: { type: 'number', min: -180, max: 180 },
        size: { type: 'number', min: 0.002, max: LIMITS.osmBboxDegMax, default: 0.01 },
      },
      handler: async (ctx, { lat, lon, size }) => {
        const s = Number(size) || 0.01;
        const half = s / 2;
        const south = Math.max(-85, lat - half);
        const north = Math.min(85, lat + half);
        // normalize lon wrap
        const west = lon - half;
        const east = lon + half;
        const bbox = `${south},${west},${north},${east}`;
        // Minimal query: buildings + highways, geometries inline
        const ql = `[out:json][timeout:12];(way["building"](${bbox});way["highway"](${bbox});relation["building"](${bbox}););out geom;`;
        const body = `data=${encodeURIComponent(ql)}`;
        const tryFetch = async (base) => {
          return fetchUpstream(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: ctx.signal,
            log: ctx.log,
            timeoutMs: 6000,
            retries: 1,
          });
        };
        let data;
        try {
          data = await tryFetch(U.overpass);
        } catch (e) {
          ctx.log('osmChunk: primary overpass failed, trying mirror', { error: String(e?.message || e) });
          data = await tryFetch(U.overpassMirror);
        }
        // Project / cap — keep payload lightweight for mobile
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        // Filter to keep only needed tags and geometry; drop heavy metadata
        const capped = elements.slice(0, LIMITS.osmMaxElements);
        const projected = capped.map((el) => {
          const base = { type: el.type, id: el.id };
          if (el.tags) {
            const t = {};
            if (el.tags.building) t.building = String(el.tags.building).slice(0, 32);
            if (el.tags.highway) t.highway = String(el.tags.highway).slice(0, 32);
            if (el.tags['building:levels']) t['building:levels'] = String(el.tags['building:levels']).slice(0, 4);
            if (el.tags.name) t.name = String(el.tags.name).slice(0, 80);
            if (Object.keys(t).length) base.tags = t;
          }
          if (Array.isArray(el.geometry)) {
            // quantize to 7 decimals (~1 cm) but store as numbers
            base.geometry = el.geometry.map((pt) => ({ lat: Number(Number(pt.lat).toFixed(7)), lon: Number(Number(pt.lon).toFixed(7)) }));
          }
          if (el.bounds) base.bounds = el.bounds;
          return base;
        });
        return {
          bbox: { south, west, north, east, size: s, center: { lat, lon } },
          count: projected.length,
          total: elements.length,
          truncated: elements.length > projected.length,
          elements: projected,
          source: 'overpass',
        };
      },
    },
  ];

  return routes;

  /* ── provider helpers that need the route-table context ───────── */

  async function steamAppDetails(appId, ctx) {
    const data = await fetchUpstream(`${U.steamStore}/appdetails?appids=${appId}&cc=us&l=english`, ctx);
    const entry = data?.[appId];
    if (!entry?.success) throw new UpstreamError('steam app not found', { status: 404 });
    return entry.data;
  }

  async function igdbSearch(name, ctx) {
    if (!name || !hasCredential(env.TWITCH_CLIENT_ID) || !hasCredential(env.TWITCH_APP_TOKEN)) return null;
    const rows = await fetchUpstream(`${U.igdb}/games`, {
      method: 'POST',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${env.TWITCH_APP_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      },
      body: `search "${String(name).replace(/"/g, '')}"; fields name, storyline, summary, cover.url, involved_companies.company.name; limit 1;`,
      ...ctx,
    });
    return Array.isArray(rows) ? rows[0] : null;
  }
}

/* ── shared projections used by more than one route ─────────────── */

export function projectRawgDetails(details) {
  if (!details) return null;
  return {
    id: details.id,
    name: details.name,
    description_raw: trim(details.description_raw, LIMITS.descriptionChars) || null,
    background_image: rawgImage(details.background_image, 1280) || null,
    background_image_additional: rawgImage(details.background_image_additional, 1280) || null,
    developers: (details.developers || []).slice(0, 3).map((d) => ({ name: d.name })),
    publishers: (details.publishers || []).slice(0, 3).map((p) => ({ name: p.name })),
    released: details.released || null,
    playtime: details.playtime ?? null,
    esrb_rating: details.esrb_rating ? { name: details.esrb_rating.name } : null,
    genres: (details.genres || []).slice(0, 4).map((g) => ({ name: g.name })),
    metacritic: details.metacritic ?? null,
    website: details.website || null,
    reddit_url: details.reddit_url || null,
    tags: (details.tags || [])
      .filter((t) => t.language === 'eng')
      .slice(0, LIMITS.wikiTags)
      .map((t) => ({ name: t.name })),
    platforms: (details.platforms || []).slice(0, 8).map((p) => ({ platform: { name: p.platform?.name } })),
  };
}

export function projectSteamApp(data) {
  if (!data) return null;
  const stripTags = (html) =>
    html
      ? String(html)
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<li[^>]*>/gi, '\n- ')
          .replace(/<[^>]+>/g, '')
          .replace(/\n\s*\n/g, '\n')
          .trim()
      : '';
  return {
    name: data.name,
    type: data.type,
    is_free: !!data.is_free,
    price: data.price_overview?.final_formatted || (data.is_free ? 'Free to Play' : null),
    header_image: data.header_image,
    controller_support: data.controller_support === 'full' ? 'Full Controller Support' : null,
    short_description: trim(stripTags(data.short_description), 400),
    requirements: {
      minimum: stripTags(data.pc_requirements?.minimum),
      recommended: stripTags(data.pc_requirements?.recommended),
    },
    requirements_html: { minimum: data.pc_requirements?.minimum, recommended: data.pc_requirements?.recommended },
    release_date: data.release_date?.date || null,
  };
}

/** Promise.allSettled helper: log the failure, hand the UI an empty list. */
function settled(result, log, label) {
  if (result.status === 'fulfilled') return result.value;
  log('route: partial failure', { label, error: String(result.reason?.message || result.reason) });
  return [];
}

function buildCredentialReport(env) {
  return Object.fromEntries(
    ['RAWG_API_KEY', 'STEAM_WEB_API_KEY', 'TWITCH_CLIENT_ID', 'TWITCH_APP_TOKEN', 'PANDASCORE_API_KEY'].map((k) => [
      k,
      hasCredential(env[k]) ? 'configured' : 'missing',
    ]),
  );
}

export default createRoutes;
