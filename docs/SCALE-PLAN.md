# Pixellon — scale, cost and resource plan

> **Scope of this plan.** The constraint we are optimising for is **server and
> hosting cost** — bandwidth, third-party API quota, upstream rate limits — with
> **content-graph scale** ("larger maps": thousands of games, many routes, long
> lists) as the growth assumption, and low-end devices as a secondary constraint.

Everything in §2 is implemented and verified by the four self-tests described in
§6. §5 is the honest backlog.

---

## 1. The starting position (measured, not guessed)

Baseline captured on this checkout before any change:

| Metric | Baseline |
| --- | --- |
| Production JS | **one 648.59 kB bundle / 196.03 kB gzip** |
| CSS | 52.73 kB / 9.05 kB gzip |
| Third-party calls per Home page view | 3 RAWG calls, browser → RAWG, with `VITE_RAWG_API_KEY` |
| Third-party calls per Codex page view | up to 6 (RAWG details → RAWG stores → Steam appdetails, IGDB, Twitch, SteamSpy) |
| Browser-side caching | none (no TTL, no dedupe, no persistence, no ETag awareness) |
| Server-side caching | none |
| Production API | **none** — `/api/*` existed only as dev-server proxies, so those features 404 on any real host |
| Secrets | `VITE_RAWG_API_KEY` **committed in `.env` and inlined into the public bundle** |
| List rendering | every row mounted at once (up to 60 cards, 60 image requests) |
| Images | full-size originals, no `srcset`, no dimensions (CLS) |
| Cat | 60 fps `fillRect` drawing forever, even hidden or idle |

### The four findings that mattered most

**F1 — The API key was public.** `VITE_RAWG_API_KEY=8788dc…` was tracked in git and
inlined by Vite into the shipped JS. Anyone (`view-source`, devtools, or GitHub
search) could spend the project's 20 000 requests/month quota. *Fix: keys are
server-side only (non-`VITE_` names), `.env` is untracked, `.env.example` is the
template.* **Action still required by the owner: rotate the key — the old value is
in git history and must be treated as burned.**

**F2 — There was no production API.** `vite.config.js` proxied RAWG/Steam/IGDB from
the *dev server only*. A deployed build would ship a UI whose Steam price, system
requirements, IGDB storyline and SteamSpy panels silently 404. *Fix: a real,
deployable API layer (`server/`) mounted identically in dev, preview, Node origin
and edge.*

**F3 — Every visitor paid for every upstream call.** No cache anywhere, so the
project's cost scaled linearly with users instead of with time. Rough math for
RAWG's free tier (20 000 req/month):

| Traffic | Old (per-user calls) | New (per-TTL-window calls) |
| --- | --- | --- |
| 1 000 visits/day | ~90 000/mo → **4.5× over quota** | ~13 000/mo (Home@10 min + slow-moving feeds) |
| 10 000 visits/day | ~900 000/mo → **45× over quota** | still ~13 000–20 000/mo |

The new figure is *independent of traffic*: 144 ten-minute windows per day × 3
calls, plus a handful of daily calls for 6–24 h routes. That is the difference
between a project that dies on a good day and one that survives it.

**F4 — The catalog could not grow.** One bundle meant one `import` of everything;
lists mounted every row; there was no authored-content path at all. Adding the
1 000th game would have made the site slower for every visitor.

## 2. What shipped

### 2.1 Server layer — `server/` (new, zero dependencies)

* `lib/cache.js` — TTL cache with **single-flight** (N concurrent misses → 1
  upstream call) and **serve-stale-while-revalidate**; LRU eviction; counters.
* `lib/upstream.js` — timeouts, bounded retries with jitter, `Retry-After`
  handling, typed errors, never caches a failure.
* `lib/http.js` — whitelist query validation, projection, weak ETags, and the
  CDN cache headers that make the whole design work.
* `lib/ratelimit.js` — per-IP fixed window so one scraper cannot burn a shared key.
* `config.js` — the TTL table (§3.2 of `ARCHITECTURE.md`) as reviewable policy.
* `routes.js` — 20 named routes: composites, projection, credential checks,
  partial-failure tolerance, negative caching for 404s.
* `api.js`, `vite-plugin.js`, `standalone.js`, `edge.js` — one router, four hosts.

### 2.2 Client

* **Route-level code splitting** — 13 lazy routes; the shell no longer carries the
  wiki renderer or every page.
* **`httpCache`** — TTL + single-flight + `sessionStorage` + SWR + ETag on the
  browser side, so navigation and reloads are free.
* **`https://`/same-origin only** — no page talks to a third party directly any
  more (also removed two mixed-content and CORS-roulette bugs).
* **`SmartImage`** — provider-aware `srcset`, lazy/async, reserved space, local
  placeholder on failure.
* **`useIncrementalList` + `LoadMore`** — windowed rendering on Deals (60 rows),
  Streams (40), FreeGames, Esports, News; `content-visibility: auto` on every card
  so off-screen rows cost no layout or paint.
* **`contentIndex`** — manifest + shards + per-game chunks; local-first search.
* **PixelCat device budget** — measured stride, exact unchanged-pose skips, DPR cap,
  loop stopped when hidden/off-screen.
* **Fonts** — 12 files → 8, non-blocking load, `font-display: swap`.
* **Error boundary** + reduced-motion support + sample-data fallback for catalog
  pages.

### 2.3 Verified results

Bundle (production build, `npm run build`):

| Chunk | Raw | Gzip | When it loads |
| --- | --- | --- | --- |
| `react` (react, react-dom, react-router) | 344.57 kB | 107.78 kB | always |
| `index` (app shell + nav + cat) | 50.72 kB | 17.25 kB | always |
| `motion` (framer-motion) | 121.02 kB | 39.13 kB | **only** News/Streams/Esports/FreeGames/Profile/Gateway |
| `markdown` (react-markdown + remark) | 38.34 kB | 11.53 kB | **only** Codex routes |
| CSS | 58.11 kB | 9.81 kB | always |
| route chunks (13 pages) | 2.4–18 kB | 1.1–5.4 kB | per navigation |
| content document chunks | 1.2–2.1 kB | 0.7–1.2 kB | per Codex page opened |

**Cold first visit to Home: 196.03 kB gzip → 128.0 kB gzip (−35%), and none of it
is the markdown or motion stack.** That figure is the sum of the five chunks the
route actually pulls (`react` 103.8 + shell 16.6 + Home 2.5 + api 2.0 + SectionHeader
1.6 + runtime 0.4 kB gzip), not an estimate. Excluding React, the app's own code for
the most-visited route is ~6 kB gzip.

Behavioural results, from the self-tests in §6:

| Behaviour | Result |
| --- | --- |
| 25 repeat requests to `/api/home` | 0 additional upstream calls, 100% cache hits |
| 20 concurrent cold requests | **1** upstream call (single-flight) |
| Expired entry | served instantly as `stale` + exactly 1 background refresh |
| Repeat visitor with ETag | `304`, empty body |
| `1 browser → /api/wiki/:id` | 4 upstream calls, cached together (was 5–6 browser requests in series) |
| Response projection | 4.5× smaller than upstream on game details; 4 KB cap asserted |
| Dead game id | 1 upstream call, then negative-cached for 60 s |
| Flood with `API_RATE_LIMIT=3` | `200,200,200,429,429` |
| Credential leakage to the browser | asserted absent across 6 route bodies |
| `index.html` over the wire | 2288 B → **855 B Brotli** (−63%) |
| Hashed asset caching | `public, max-age=31536000, immutable` |
| Deep link `/codex/326243/bosses` on a cold server | HTTP 200 app shell (SPA fallback) |
| **PixelCat idle canvas work** | **48% of frames skipped** (5610 draws / 5190 skips in a 3-minute idle run) |
| PixelCat on a low-power device | stride 2 (halves wake-ups) + DPR 1.5 instead of 2 (≈36% fewer pixels per fill) |

## 3. The cost model in one picture

```
user → CDN ──(hit, ~90% of requests)──► response          [costs nothing extra]
         │
         └─(miss)─► origin ──► TtlCache ──(fresh)──► response
                                  │
                                  └─(miss / stale-refresh)─► upstream  [quota]
```

Three multipliers stack: **browser cache** (navigation/reload), **in-process
cache + single-flight** (concurrent users), **CDN `s-maxage` + SWR** (all users).
Upstream traffic becomes a function of *time*, not of popularity — which is the
only way a free-tier quota survives a front-page day.

## 4. Deployment topology (recommended)

```
Static host / CDN  ──►  dist/            (immutable hashed assets, no-cache HTML)
Edge / Node origin ──►  server/standalone.js  or  server/edge.js   (/api/*)
```

* `public/_headers` and `public/_redirects` encode the caching policy and the SPA
  fallback for Netlify/Cloudflare-style hosts — keep them in sync with
  `server/standalone.js#cachePolicy()`.
* For Vercel, mirror `_headers` in `vercel.json`; for Cloudflare Workers, import
  `createEdgeHandler()` from `server/edge.js`.
* Set the five credentials as *server* environment variables. They must not carry a
  `VITE_` prefix and must not appear in any client bundle.
* Behind a shared CDN cache the origin sees mostly health checks and misses; a
  single small instance is enough for a very large audience.
* If you scale the origin horizontally, replace `TtlCache` with a shared store
  (KV/Redis) — the interface is already isolated in `server/lib/cache.js`.

## 5. Backlog, ranked

| # | Item | Impact | Effort |
| --- | --- | --- | --- |
| 1 | **Rotate the RAWG key** (it is public in git history) | Security/quota — do this first | 5 min |
| 2 | Self-host + subset the three font families as `woff2` | Removes 3 external requests and ~2 render-blocking hops; −60–70 kB | 1–2 h |
| 3 | Precompute catalog snapshots at build time (`content/`-style JSON for lists) | Removes the last cold-start upstream calls; makes Home fully static | half a day |
| 4 | Replace `rss2json` with own RSS parsing in the API layer | Removes a third-party relay and its rate limit; one less dependency on someone else's uptime | 2–3 h |
| 5 | `CacheStorage`/service worker for images + route chunks | Repeat visits ≈ offline; big win on metered mobile | half a day |
| 6 | Move `TtlCache` to KV when the origin is replicated | Correctness under horizontal scale | 2–3 h |
| 7 | Server-side rendering / pre-rendering of Codex routes | SEO for the one surface that deserves it; needs a Node host (already exists) | 1–2 days |
| 8 | Replace framer-motion on the four remaining pages with CSS transitions | −39 kB gzip on those routes; removes a main-thread cost | half a day |
| 9 | `preconnect`/preload the top image host per page | Small LCP win on image-heavy routes | 1 h |
| 10 | Content CI: validate documents, fail on stale manifest, check link rot | Keeps the moat (authored content) honest as it grows | 2–3 h |
| 11 | RUM (real user monitoring) with a strict payload budget | Turns these estimates into measurements on real devices | half a day |
| 12 | Image proxy with `AVIF`/`WebP` conversion for non-resizable hosts | 30–50% smaller images on Steam/detail banners | half a day |

## 6. Quality gates

```bash
npm run test          # all four suites
npm run test:api      # 16 assertions — cache, single-flight, SWR, ETag, limits,
                      #   validation, rate limiting, negative cache, projection,
                      #   credential custody, graceful degradation (offline, mock upstream)
npm run test:render   # 15 routes rendered to HTML through Vite SSR — catches the
                      #   class of breakage a bundler compiles but a browser explodes on
npm run test:cat      # 12 minutes of cat behaviour simulated headlessly, incl.
                      #   the draw-efficiency floor
npm run test:serve    # 11 assertions against the real production server over HTTP —
                      #   compression, immutable caching, SPA fallback, traversal,
                      #   CDN headers, 304s, cache hits
npm run content:index -- --check   # fails when the content manifest is stale
```

None of the suites need network access, so they run in CI and on a plane. That is
deliberate: cost regressions are exactly the kind of thing that only shows up in
production, and a mock upstream plus a real router makes them testable locally.

## 7. Guardrails for the next 100× of content

1. **Never import a whole catalog.** `content/index.json` is a manifest; documents
   are fetched per route and the manifest itself is a lazy chunk.
2. **Never let a list render unbounded.** `useIncrementalList` + `list-window` for
   anything that can exceed ~30 rows.
3. **Never add a `VITE_` secret.** If a value is a credential, it belongs in a
   route handler, and the route gets a TTL and a projection.
4. **Never hit an upstream from the browser.** Same-origin `/api/*` only; this is
   what keeps caching, rate limiting and projection enforceable.
5. **Every new endpoint declares a cache policy.** A route without a TTL is a
   route that will call an upstream once per visitor.
6. **Watch `dist/assets/index-*.js`.** A shell-chunk regression above ~60 kB means
   something heavy (a library, a data file, a whole page) leaked into the entry.
