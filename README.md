# Pixellon

**Play. Share. Belong.** — a gaming hub: news, reviews, deals, streams, esports,
indie spotlights, a starter gateway, and a *Codex* (a wiki-shaped encyclopedia of
games) — plus a pixel cat that lives along the bottom edge of every page.

It is a React SPA served as static files, with a small zero-dependency server-side
API layer that owns every third-party credential, every cache lifetime, and every
response shape.

* **How it works** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
* **Cost, scale and performance plan** → [`docs/SCALE-PLAN.md`](docs/SCALE-PLAN.md)
* **What changed, and what was fixed** → [`CHANGELOG.md`](CHANGELOG.md)
* **Authoring Codex content** → [`content/README.md`](content/README.md)

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the keys you have (all of them optional)
npm run dev               # http://localhost:5173  — UI + API, same cache as prod
```

Missing keys are not fatal: routes that need one return a clear `missing_credentials`
state and the UI degrades instead of breaking. `/api/health` tells you what is
configured.

> ### ⚠️ If you are coming from an older checkout
>
> The RAWG key used to live in `.env` as `VITE_RAWG_API_KEY` — which means it was
> committed to git **and** inlined into the public JavaScript bundle. Treat it as
> burned and rotate it at <https://rawg.io/apidocs>. Credentials in this project
> are server-side only from now on: never add a `VITE_` prefix to a secret, because
> Vite inlines `VITE_*` values into the client bundle.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with the API layer mounted (HMR, real cache) |
| `npm run build` | Production build into `dist/` (code-split, hashed, no sourcemaps) |
| `npm run serve` | Production server: static `dist/` + Brotli + immutable caching + SPA fallback + API |
| `npm run preview` | Vite preview with the same API layer |
| `npm run test` | All four self-test suites (no network required) |
| `npm run test:api` | Cache, single-flight, SWR, ETag, validation, rate limiting, projection, key custody |
| `npm run test:render` | Every route rendered to HTML through Vite SSR — catches render-time breakage |
| `npm run test:cat` | 12 minutes of cat behaviour simulated headlessly, incl. draw efficiency |
| `npm run test:serve` | The real production server over HTTP: compression, caching, fallback, 304s |
| `npm run content:index` | Regenerate the Codex manifest + search shards (`-- --check` in CI) |
| `npm run lint` | oxlint |

## Project layout

```
src/
  App.jsx                 lazy route table + Suspense + error boundary
  pages/                 13 routes, one chunk each
  components/            Navbar · Footer · GameCard · SmartImage · LoadMore ·
                         PageTransition · ErrorBoundary · PixelCat/
  hooks/                 useIncrementalList (windowed list rendering)
  data/                  contentIndex.js (Codex "map") · mockData.js (offline fallback)
  utils/                 api.js (same-origin data layer) · httpCache.js (TTL/SWR cache)
  context/               CodexContext (localStorage page editing)
server/
  api.js                 router: validate → cache → project → respond
  routes.js              19 routes: composites + projection, keys stay here
  config.js              cache policy per route (the cost model)
  lib/                   cache · upstream · http · ratelimit · env
  vite-plugin.js         mounts the API into dev + preview
  standalone.js          production origin (static + compression + SPA fallback)
  edge.js                Web-Request adapter for edge runtimes
content/                 authored Codex documents + generated manifest
scripts/                 build-content-index · api-selftest · serve-selftest · render-selftest
docs/                    ARCHITECTURE.md · SCALE-PLAN.md
```

## Deployment

* Build with `npm run build`; serve `dist/` from any static host or CDN.
* Run the API with `npm run serve` (Node) or `createEdgeHandler()` from
  `server/edge.js` (Workers/Edge).
* `public/_headers` and `public/_redirects` carry the cache policy and the SPA
  fallback for hosts that read them. Keep them in sync with
  `server/standalone.js#cachePolicy()`.
* Set the credentials as **server** environment variables (no `VITE_` prefix).

The short version of why this shape: **the CDN serves the traffic, the origin
serves cache misses, and the upstream API is called once per TTL window instead of
once per visitor.** Details and measurements in [`docs/SCALE-PLAN.md`](docs/SCALE-PLAN.md).
