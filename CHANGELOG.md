# Changelog

All notable changes to Pixellon are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Branch status.** Everything under `[Unreleased]` lives on
> `arena/01a0a2cd-pixellon-games` only. Nothing here is merged into `main`, and
> nothing should be merged until the owner has reviewed it and rotated the RAWG
> key (see Security below).

---

## [Unreleased] — 2026-09-15

Work on cost, scale and low-end devices: a server-side cached API layer, a
code-split client, an authored-content layer for the Codex, and a device budget
for the pixel cat. Plus the bugs found while measuring.

### Security

- **Exposed API key removed from the client bundle.** `VITE_RAWG_API_KEY` was
  committed in `.env` *and* inlined by Vite into the public JavaScript, so anyone
  could read it from devtools and spend the project's RAWG quota.
  - `.env` is untracked (`git rm --cached`), `.gitignore` now covers `.env` and
    `.env.*`, and `.env.example` is the tracked template.
  - Credentials use server-only names (`RAWG_API_KEY`, `STEAM_WEB_API_KEY`,
    `TWITCH_CLIENT_ID`, `TWITCH_APP_TOKEN`, `PANDASCORE_API_KEY`). Never add a
    `VITE_` prefix to a secret — Vite inlines those.
  - **Action still required by the owner:** rotate the RAWG key. The old value is
    in git history and must be treated as burned.
- **Credential redaction in logs.** Upstream URLs carry keys in the query string
  and were being written to the server log verbatim. `sanitizeUrl()` now replaces
  `key`, `api_key`, `apikey`, `token`, `access_token`, `client_secret` and
  `client_id` values with `REDACTED` before they reach a log line, an error
  message or a stack trace.
- **Remote HTML no longer reaches the DOM unsanitised.** News summaries from the
  RSS feed were rendered with `dangerouslySetInnerHTML`. The API layer now strips
  tags and scripts and truncates to 320 characters, which also shrinks the payload.
- **No more arbitrary upstream parameters.** Endpoints validate against a
  whitelist per route, so the shared key cannot be used as a general-purpose
  scraping proxy. Invalid input returns `400` without touching the upstream
  (asserted in the test suite).
- **Rate limiting.** Per-IP fixed window on `/api/*` (default 240 req/min,
  `API_RATE_LIMIT=off` to disable) so a single client cannot burn a shared key.

### Fixed

- **The production API did not exist.** `/api/steam`, `/api/igdb` and
  `/api/steamapi` were configured as *dev-server* proxies only, so a deployed
  build would silently 404 Steam prices, PC requirements, IGDB storylines and
  SteamSpy stats. There is now one router (`server/api.js`) mounted identically in
  dev, preview, the Node origin and edge runtimes.
- **Hashed assets were not cached as immutable.** The cache-policy regex expected
  Vite's old `name.hash.ext` layout; Vite 8 emits `name-HASH.ext`, so every asset
  silently fell back to a 1-hour TTL and repeat visitors re-downloaded the bundle.
  Now `public, max-age=31536000, immutable` (asserted by `test:serve`).
- **`500` on short search queries.** The cache called `loader().then(...)`, which
  threw when a route handler returned a plain value (e.g. `[]` for a query shorter
  than 2 characters). Loaders are now normalised through `Promise.resolve().then(...)`.
- **Oversized upstream pages could not be capped.** `rawgList()` trusted the
  upstream `page_size`; it now slices to the requested size so a pathological
  response cannot blow up cache entries, CDN storage or client parse time.
- **Mixed content blocked Steam profile icons.** `http://media.steampowered.com`
  on an HTTPS page meant browsers refused to load the image. Now `https://`.
- **Two sequential requests on the profile page.** Profile and owned-games were
  fetched one after the other through two upstream calls; they are now a single
  cached `/api/steam/player/:id` composite.
- **Deep links 404'd on static hosting.** `/codex/:id/:page` returned 404 on any
  host without a rewrite. `public/_redirects` (and the standalone server's SPA
  fallback) now serve the app shell for non-asset paths, while genuinely missing
  assets still 404.
- **Vite rejected proxied preview hosts.** `allowedHosts: true` on both `server`
  and `preview` so sandboxed/proxied environments do not get a 403.
- **`window.location` was dereferenced unguarded** in `PixelCat` outside an effect,
  making the module unsafe to import in non-browser contexts (SSR, workers, tests).
  Guarded via `debugRequested()`.
- **A render error blanked the entire site.** A single thrown component unmounted
  the whole React tree. An `ErrorBoundary` (remounted per route) now isolates the
  failure and offers retry, while nav, footer and the cat stay alive.
- **`content:index --check` failed on every run** because it compared a manifest
  containing `generatedAt`. It now compares everything except the timestamp, so the
  CI gate is usable.
- **Event handlers leaked past unmount.** Catalog pages could `setState` after the
  component was gone; fetches are now cancelled/guarded (`cancelled`, `AbortController`).
- **The cat never stopped.** The rAF loop kept scheduling work in background tabs,
  off-screen layouts and print views. It now stops entirely when hidden or
  off-screen, and restarts on return.
- **Test harness double-drew** in the cat self-check, inflating draw statistics;
  the simulation now mirrors the real draw/skip budget exactly.

### Performance & cost

- **Bundle: one 648.6 kB (196.0 kB gzip) chunk → a 50.7 kB (17.3 kB gzip) shell
  plus per-route chunks.** Cold visit to Home is **196.0 → 128.0 kB gzip (−35%)**,
  measured as the sum of the chunks that route actually pulls. `react-markdown`
  (11.5 kB gzip) now loads only on Codex routes and `framer-motion` (39.1 kB gzip)
  only on the six pages that use it.
- **framer-motion removed from the app shell.** `AnimatePresence` pulled the whole
  motion library — and a per-element measurement loop — onto every page for a
  300 ms fade. `PageTransition` is now CSS-only, reusing the existing `fade-up`
  keyframe. Trade-off documented in the component: no exit animation.
- **Browser-side caching added** (`src/utils/httpCache.js`): TTL memory cache,
  single-flight dedupe, `sessionStorage` persistence with a byte budget,
  stale-while-revalidate and ETag revalidation. Navigating Home → Deals → Home is
  now 0 requests; a reload inside the TTL is 0 bytes.
- **Server-side caching added**: `TtlCache` with single-flight and
  serve-stale-while-revalidate, plus `Cache-Control`/`CDN-Cache-Control` and ETags
  on every response. 25 repeat requests → 0 extra upstream calls; 20 concurrent
  cold requests → **1** upstream call.
- **Upstream cost is now a function of time, not traffic.** Per-route TTLs
  (`server/config.js`) plus CDN caching take RAWG usage from ~90 000 requests/month
  at 1 000 visits/day (4.5× over the free tier) to ~13 000–20 000/month regardless
  of traffic.
- **Request waterfalls collapsed into composites**: `/api/wiki/:id` (was 5–6
  browser requests in series), `/api/home` (3 upstream calls, one request),
  `/api/steam/player/:id` (was 2 sequential calls).
- **Response projection**: upstream payloads are trimmed to the fields the UI
  renders — 4.5× smaller on game details, and list payloads are capped per route.
- **Long lists render in windows** (`useIncrementalList` + `LoadMore`): Deals (60
  rows), Streams (40), FreeGames, Esports, News. Cards also carry
  `content-visibility: auto`, so off-screen rows cost no layout or paint.
- **Images are sized, lazy and shift-free** (`SmartImage`): provider-aware
  `srcset` (`?w=` for RAWG/Unsplash, `{width}x{height}` for Twitch thumbnails),
  reserved aspect ratio, `decoding="async"`, local placeholder on error, and no
  referrer leakage.
- **Fonts**: 12 files → 8, loaded non-blocking with `font-display: swap` and a
  `<noscript>` fallback, so first paint never waits on Google Fonts.
- **PixelCat device budget**: a stride chosen from measured per-frame work, device
  class (`hardwareConcurrency`, `deviceMemory`, `saveData`) and motion preference;
  DPR capped at 1.5 instead of 2; and unchanged-pose skips that are exact because
  the renderer snaps every rect to whole art pixels. Result: **52% of idle frames
  are not painted** (5610 draws / 5190 skips over a 3-minute simulated idle run),
  with a hard cap on consecutive skips so it can never look frozen.
- **Tailwind**: added `list-window` / `list-window-fast` utilities for cheap
  off-screen containment, and a global `prefers-reduced-motion` clamp for the
  CSS-only animations.
- **Brotli/gzip on the origin** with an mtime-keyed compression cache:
  `index.html` 2 288 B → **855 B (−63%)**.

### Added

- `server/` — a zero-dependency API layer: router, 20 named routes, per-route
  cache policy, projection, validation, rate limiting, negative caching, typed
  upstream errors with retries/backoff/`Retry-After`.
- `server/standalone.js` — production origin: static `dist/`, compression,
  immutable caching, SPA fallback, traversal protection.
- `server/edge.js` — Web `Request` adapter so the same router runs on
  Workers/Edge/Deno.
- `server/vite-plugin.js` — mounts the API into `vite dev` and `vite preview` so
  development and production share one code path.
- `src/data/contentIndex.js` + `content/` — the Codex content map: generated
  manifest, per-letter search shards, one lazily-imported JSON chunk per game.
  Local-first search means authored titles cost zero upstream requests.
- `scripts/build-content-index.mjs` — manifest/shard generator with a `--check`
  mode for CI.
- `src/components/SmartImage.jsx`, `src/utils/imageVariants.js`,
  `src/hooks/useIncrementalList.js`, `src/components/LoadMore.jsx`,
  `src/components/ErrorBoundary.jsx`.
- `public/_headers` and `public/_redirects` — cache policy and SPA fallback for
  static hosts, kept in sync with the standalone server.
- Catalog pages fall back to local sample data when the API fails or returns an
  empty catalog (lazily imported, so it costs nothing on the happy path). User
  data — profiles, wiki bundles — still fails honestly rather than showing stale
  information.
- `docs/ARCHITECTURE.md` and `docs/SCALE-PLAN.md` — how the system works, the
  measured before/after, and the ranked backlog.

### Changed

- `src/utils/api.js` talks only to same-origin `/api/*`; every page that reached
  a third party directly (CheapShark, SteamSpy, Steam) now goes through the cached
  layer.
- Pages that fetch have real loading and error states instead of empty screens,
  and all timers/requests are cancelled on unmount.
- `Home` now makes one request (`/api/home`) instead of three parallel ones.
- Codex search is local-first: authored content is searched in the browser from a
  shard; the API is only used as a fallback, with a 300 ms debounce and abort.
- Wiki pages merge authored content (authoritative) over API-derived data, and
  generate an overview when only one of the two sources is available.
- `vite.config.js`: chunk policy (`react`/`motion`/`markdown`/`icons`/`vendor`),
  `target: es2020`, `cssCodeSplit`, `chunkSizeWarningLimit: 250`, preview host
  settings.

### Tests

Four offline suites — no network required, so they run in CI and on a plane:

- `npm run test:api` — **17 assertions**: caching, single-flight, SWR, ETag/304,
  projection ratios, composites, validation, rate limiting, negative caching,
  credential custody (responses *and* logs), graceful degradation.
- `npm run test:render` — **15 checks**: every route plus the app shell rendered to
  HTML through Vite's SSR pipeline; catches the class of breakage a bundler
  compiles but a browser explodes on. (It found the unguarded `window.location`.)
- `npm run test:cat` — 12 minutes of cat behaviour simulated headlessly, including
  a new draw-efficiency floor.
- `npm run test:serve` — **11 assertions** against the real production server over
  HTTP: compression negotiation, immutable asset caching, SPA fallback, traversal
  protection, CDN headers, 304s, cache hits, JSON 404s for unknown API routes.
  (It found the broken immutable-caching regex.)

### Docs

- `README.md` rewritten: quick start, the key-rotation warning, script table,
  project layout, deployment notes.
- `content/README.md`: document format, resolution order, and the rules of thumb
  for keeping the catalog scalable.
- `docs/ARCHITECTURE.md`: aim, tech, runtime architecture, load sequence, content
  map, cat system, trade-offs and an honest moat assessment.
- `docs/SCALE-PLAN.md`: the measured audit, what shipped, the cost model, the
  deployment topology, the ranked backlog and the guardrails for the next 100× of
  content.

---

## [0.0.0] — prior state

Initial Vite + React template state of the repository (commit `a9ad4e7` on
`main`): single-bundle client, browser-side third-party API calls with an exposed
`VITE_` key, dev-server-only proxies, no caching and no content layer.
