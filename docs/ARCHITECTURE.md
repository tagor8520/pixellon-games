# Pixellon — architecture

> **What this is.** A gaming hub: news, reviews, deals, streams, esports, an indie
> spotlight, a starter gateway, and a *Codex* — a wiki-shaped encyclopedia of games.
> It is a React single-page app served as static files, with a small server-side
> API layer that owns every third-party credential, every cache lifetime and every
> response shape.

This document explains **what the project is, how it works, what it is trying to
be, and what actually defends it**. Read [`SCALE-PLAN.md`](./SCALE-PLAN.md) for the
measured audit and the cost roadmap.

---

## 1. Aim

Pixellon is built on the brand line *Play. Share. Belong.* The product thesis is
that gaming coverage is fragmented — news on one site, deals on another, wikis on
a third, stream discovery on a fourth, and esports schedules on a fifth — and that
a single hub with a coherent identity can beat the sum of its parts.

Concretely, the product bets on three things:

| Bet | What it looks like in the code |
| --- | --- |
| **One hub, many feeds** | Nine content surfaces (`news`, `deals`, `streams`, `esports`, `indie`, `calendar`, `reviews`, `gateway`, `codex`) behind one nav, one design system, one loading language |
| **A Codex you own** | Authored, sharded content documents in `content/` that are authoritative over third-party data, plus a local editor (`localStorage` today) so pages can be written without a CMS |
| **A site with a soul** | `PixelCat` — a procedurally drawn pixel cat that lives along the bottom edge and reacts to the cursor; a hand-built brand kit (logo, palette, pixel decorations) rather than a template |

## 2. Tech stack

| Layer | Choice | Why it is the right choice here |
| --- | --- | --- |
| UI | **React 19** | Concurrent features, no legacy baggage; the app is component-dense and interactive |
| Build | **Vite 8 (Rolldown)** | Sub-second builds, first-class code splitting, native `advancedChunks`-style grouping |
| Routing | **React Router 7** | Real URLs per surface; `lazy()` per route keeps the shell tiny |
| Styling | **Tailwind v4** (`@theme`, `@utility`) | Brand tokens live in CSS, not in a JS theme; zero runtime cost |
| Markdown | **react-markdown + remark-gfm** | Codex pages are Markdown; isolated in its own chunk, loaded only on Codex routes |
| Motion | **framer-motion** (route-scoped) | Kept for the four pages that choreograph lists; removed from the app shell |
| API | **Node 22, zero dependencies** | `server/` is plain `node:http` + `fetch` — no express, no framework to keep patched |
| Tests | **node:test-free scripts** (`node --check`-style asserts) | Four self-test scripts that need no runner and no network |
| Content | **JSON documents + generated manifest** | Sharded, lazily imported, cacheable like any static asset |

Notably absent, on purpose: **no CMS, no database, no auth server, no ORM.** The
whole product is static files plus a caching proxy. That is a deliberate cost and
complexity decision — see [`SCALE-PLAN.md`](./SCALE-PLAN.md).

## 3. Runtime architecture

```
                      ┌─────────────────────────────────────────────┐
   browser            │  dist/  (static, hashed, immutable assets)  │
   ────────           └─────────────────────────────────────────────┘
   index.html  ──►  entry chunk (50.7 kB / 17.3 kB gzip)
                     ├─ React + React Router          (react chunk)
                     ├─ Navbar / Footer / PixelCat    (shell)
                     └─ <Suspense> per route          (route chunk, lazy)

   route chunks ──►  Home · Codex · Deals · Streams · News · Esports ·
                     FreeGames · Profile · Indie · Reviews · Calendar · Gateway

   data                         ┌──────────────────────────────────────────┐
   ────                         │  server/  (dev middleware · preview ·    │
   fetch /api/*  ─────────────► │            standalone · edge adapter)    │
                                │                                          │
                                │  router → validate → TtlCache (single-   │
                                │  flight + SWR) → projected upstream call │
                                └───────────────┬──────────────────────────┘
                                                │  credentials from server env only
                                                ▼
                                  RAWG · Steam · SteamSpy · IGDB · Twitch ·
                                  CheapShark · FreeToGame · PandaScore · RSS
```

### 3.1 The client

* **`src/App.jsx`** — the shell. Every page is `lazy()`-loaded; a `<Suspense>`
  boundary renders a spinner while a route chunk arrives; an `ErrorBoundary`
  (remounted per pathname) keeps one broken view from blanking the site.
* **`src/utils/httpCache.js`** — the browser half of the cache: TTL memory cache,
  single-flight dedupe, `sessionStorage` persistence with a byte budget,
  stale-while-revalidate, and ETag revalidation. Navigating Home → Deals → Home
  costs zero requests; a reload inside the TTL costs zero bytes.
* **`src/utils/api.js`** — the only place that knows URLs. Same-origin `/api/*`
  only. Catalog calls fall back to `src/data/mockData.js` (lazily imported, so it
  is not in the entry bundle) when the API fails or returns an empty catalog,
  which is what keeps the site usable offline or when a key expires.
* **`src/data/contentIndex.js`** — the content "map": a generated manifest, a
  per-letter search shard, and a `import.meta.glob` registry where each game
  document is its own chunk.
* **`src/components/SmartImage.jsx`** — every remote image. Provider-aware
  `srcset` (`?w=` for RAWG/Unsplash, `{width}x{height}` tokens for Twitch),
  lazy + async decode, reserved aspect ratio, local placeholder on error.
* **`src/hooks/useIncrementalList.js`** + **`LoadMore.jsx`** — windowed list
  rendering (24 rows at a time) plus a sentinel for scroll-to-load.
* **`src/components/PixelCat/`** — the cat. Intent (`CatBehavior`), look
  (`CatAnimation`), pixels (`CatRenderer`), input (`CursorTracker`), tuning
  (`catConfig.js`), and a headless self-check that simulates 12 minutes of
  behaviour at 60 fps and asserts invariants (no NaN, every rect on the art grid,
  states reachable, no gesture chaining, reduced-motion respected).

### 3.2 The API layer

`server/` is ~1 900 lines with no dependencies and three responsibilities.

**1. Credential custody.** Keys live in `.env` (untracked) and are read by
`server/lib/env.js`. They are *never* prefixed `VITE_`, so Vite can never inline
them into a client bundle. Before this change the RAWG key was committed *and*
shipped in the JS — see the finding in `SCALE-PLAN.md`.

**2. Cost control.** `server/config.js` holds the cache policy:

| Route | TTL | Serve-stale window | Rationale |
| --- | --- | --- | --- |
| `/api/games/search` | 30 min | 2 h | user-driven, expensive, and repeats across users |
| `/api/home` | 10 min | 1 h | three upstream calls, one request, one cache entry |
| `/api/deals`, `/api/news` | 10 min | 1 h | headline freshness is the product |
| `/api/streams` | 2 min | 10 min | viewer counts go stale fast |
| `/api/esports` | 5 min | 30 min | schedules move rarely, cancellations matter |
| `/api/games/:id`, `/api/wiki/:id` | 24 h | 7 d | details are near-static |
| `/api/steamspy/app/:id`, `/api/igdb/search` | 24 h | 7 d | reference data |
| `/api/steam/app/:id` | 6 h | 24 h | prices and reviews change |
| `/api/steam/player/:id` | 5 min | 30 min | per-user, still worth a short cache |

Every response carries `Cache-Control: public, max-age=<browser>, s-maxage=<cdn>,
stale-while-revalidate=<window>` plus `CDN-Cache-Control` and a weak `ETag`. That
is the whole scaling story: **the CDN serves the traffic, the origin serves cache
misses, and the upstream serves one request per TTL window.**

**3. Shape control.** Handlers *project* upstream payloads down to the fields the
components render, and composites collapse waterfalls:

* `/api/wiki/:id` = game details + Steam app details + IGDB, in one request
  (previously 5–6 browser requests in series).
* `/api/home` = trending + top-rated + upcoming, in one request.
* `/api/steam/player/:id` = profile + top 24 games (was two sequential calls).
* Arbitrary upstream parameters are impossible: each route declares a whitelist
  (`server/lib/http.js#parseParams`), so the shared key cannot be used as a
  general-purpose scraping proxy.

### 3.3 Three hosts, one router

`server/api.js` is transport-agnostic. It is mounted by:

| Host | File | Use |
| --- | --- | --- |
| Vite dev server | `server/vite-plugin.js` | local development, HMR, same cache and same keys as production |
| Vite preview | `server/vite-plugin.js` | `npm run preview` |
| Node origin | `server/standalone.js` | `npm run serve`: static `dist/` + compression + immutable caching + SPA fallback + API |
| Edge runtime | `server/edge.js` | Cloudflare Workers / Vercel Edge / Deno Deploy via a Web `Request`→router bridge |

## 4. How a page actually loads

Taking `/codex/326243/bosses` as the most complex case:

1. HTML (2.28 kB, Brotli → 855 B) is served `no-cache`; it names the hashed entry
   chunk, which is served `immutable` for a year.
2. The shell boots: React + router + Navbar + PixelCat (128 kB gzip for the whole
   cold visit; see `SCALE-PLAN.md` for the per-chunk table).
3. The route chunk (`GameWiki`, 18 kB, plus the markdown chunk 38 kB) arrives.
4. The page asks for content in parallel:
   * `loadGameContent('326243')` → its own JSON chunk (~2 kB), local and authored;
   * `getWikiBundle('326243')` → `/api/wiki/326243` → one cached composite.
5. Authored pages win; if the game has no local document, the API-derived
   overview is generated instead. Either source alone is enough to render.
6. `WikiSidebar` fetches `/api/steamspy/app/:id` (cached 24 h) and the browser
   keeps everything in its TTL cache, so navigating between Codex pages is free.

## 5. The content "map"

The Codex is designed to grow to thousands of games without touching bundle size:

```
content/
  index.json                 manifest: id → metadata (no page bodies)   ~120 B/game
  index-shards/e.json        per-first-letter search shards             ~0.5 kB/shard
  games/326243.json          one document per game → one JS chunk       fetched on open
```

* `searchContentIndex(term)` loads **one shard** and filters locally — the search
  box costs zero upstream requests for authored titles.
* `hasLocalContent(id)` is a registry lookup that downloads nothing.
* `npm run content:index` regenerates the manifest; `--check` fails CI when it is
  stale.
* The alternative — `import allGames from './pages/all-games.json'` — would put
  the entire catalog in the entry bundle. That is the difference between a
  catalog that scales and one that does not.

## 6. The PixelCat system

The cat is the brand's most distinctive surface, so it gets its own architecture
and its own budget rules.

* **Separation of concerns:** behaviour (intent) → animation (look) → renderer
  (pixels), with input (cursor) and tuning (`catConfig.js`) alongside. Nothing
  else in the codebase knows how the cat works.
* **Zero React re-renders:** all animation state lives outside React. The component
  renders once; the rAF loop mutates a canvas and a single CSS transform. Debug
  text goes straight to a DOM node.
* **A device budget, enforced at runtime:** a stride chosen from measured work per
  frame, hardware core/memory class and `saveData`; unchanged-pose skips (the
  renderer snaps everything to whole art pixels, so an identical quantised pose
  produces identical pixels — skipping it is exact, not an approximation) bounded
  by `maxSkippedDraws`; DPR capped at 1.5; the loop fully stopped when the tab is
  hidden or the band is off-screen.
* **Verifiable:** `npm run test:cat` simulates 12 minutes headlessly and asserts
  the invariants a human cannot eyeball, including a draw-efficiency floor.
* **Sprite-ready:** `renderer.setSpriteSheet()` swaps procedural drawing for a real
  sheet, one animation at a time.

## 7. Design system

Brand tokens are declared once in `src/index.css` via Tailwind v4 `@theme`
(palette, fonts, surface scale) and consumed as utilities
(`bg-brand-primary`, `font-display`, `glow-pixel`, `pixel-card`,
`bg-grid-pattern`, `list-window`). Any new surface inherits the brand by using
tokens, never raw hex values in components. `Pixellon Brand Kit.pdf` remains the
source of truth for the visual language.

## 8. Trade-offs, stated plainly

| Decision | Cost | Why we took it |
| --- | --- | --- |
| In-process cache (per instance), not Redis | Multiple origin instances each warm their own cache | Zero infrastructure; the CDN is the shared cache. Swap in a KV store when the origin is horizontally scaled |
| Static-only front end | No per-user server rendering, SEO relies on meta tags | Hosting is nearly free and deployable to any CDN |
| `localStorage` Codex editing | Per-browser, no collaboration, no moderation | Ships the authoring flow today without auth/database; the content layer is already the right shape for a real CMS |
| framer-motion on four pages | ~39 kB gzip on those routes only | Those lists genuinely need stagger; the shell does not, so the library is route-scoped |
| Route-scoped CSS animation instead of exit transitions | No page *exit* animation | A 200 ms exit is not worth 39 kB on every route |
| Sample-data fallback for catalog pages | Content can look stale if an upstream dies | An empty homepage is a worse failure than placeholder cards; the fallback is lazy and logged |

## 9. The moat

Honestly assessed — a React site is not defensible by its code. What compounds is:

1. **Authored content.** Every page written into `content/` is an asset nobody
   else has, that survives upstream outages, API deprecations and rate limits, and
   that costs nothing to serve. This is the only genuinely defensible asset in the
   repository, and it is why the content layer exists.
2. **Unit economics.** Productized cost control — server-side keys, per-route TTLs,
   CDN caching, response projection, composites — means Pixellon can serve a
   traffic spike on free-tier API quotas. Most hobby projects in this space die
   from exactly that: one viral day and the key is dead.
3. **A distinguishable voice.** The cat, the pixel language, the brand kit, the
   tone of the copy. Feeds are a commodity; identity is not.
4. **Content-graph shape.** A manifest + sharded documents + local search is a
   foundation that survives being 100× bigger. Most competitors would have to
   rewrite.
5. **Measured quality gates.** Four self-tests (API economics, server behaviour,
   render smoke, cat invariants) make regressions visible — the compounding
   advantage of not being able to accidentally get slower.

What this is *not* defended by: the tech stack, the components, the API choices.
Any competent team can reproduce those in a week; the content, the audience and
the cost discipline are what take longer.
