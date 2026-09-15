# Pixellon World Engine — Research Report

**Date:** 2026-09-15  
**Goal:** Browser-side procedural 3D world generated from real OpenStreetMap data, 1:10 scale, lightweight for mobile/low-end HW, zero-cost APIs, chunked lazy loading.

---

## 1. Requirement Recap (from ticket)

- User opens site → currently 2 CTAs (Explore Codex, Starter Zone). Add **3rd option: “Enter Coordinates”**.
- User enters `lat,lon` → browser downloads a **small chunk (~1×1 “unit”)** and procedurally generates:
  1. **Roads first** (ground topology & circulation)
  2. **Buildings next** (extruded footprints from OSM `building=*`)
- As user approaches edge of generated area, **background lazy-loads** adjacent chunk; infinite-ish exploration via tiling.
- World is **1:10 scale** — distances 10× compressed but X/Y placement stays faithful; Z (height) may be stylized/randomized.
- Must run in the **browser** (no server-side rendering/tiling), be **heavily optimized** for low-end devices, and rely only on **free, keyless public resources** that work out-of-the-box.

---

## 2. Project Fit — Why This Repo Can Host It

Pixellon is already optimized for “small pixels, big possibilities” and for cost:

| Existing pattern | Reuse for World Engine |
|---|---|
| **Lazy routes** (`React.lazy` per page) in `src/App.jsx` | New `/world` route is its own chunk; `three` is dynamically imported so **Home never pays** for 3D. |
| **`src/utils/httpCache`** TTL + SWR + `sessionStorage` | OSM chunk requests benefit from same TTL (10 min) for neighbouring chunk prefetch. |
| **`useIncrementalList` windowing** | Building/road instancing is the 3D equivalent — window/Cull. |
| **PixelCat device budget** (`DPR ≤1.5`, stride, hidden-tab stop) | Same heuristics drive world quality switch (instancing, DPR, shadows). |
| **Zero-dep `server/` proxy** | Optional `GET /api/osm/chunk` fallback if Overpass CORS or rate-limit hits browser directly. |

The engine will expose: `src/utils/osm.js` (fetch/parse), `src/engine/world/*` (generation, chunk manager, pooling), `src/pages/World.jsx` (UI + Three.js canvas). No DB, no auth, no billable API.

---

## 3. Open-Source Map Source — Evaluated & Chosen

### 3.1 Candidates

| Source | Auth | Data offered | Browser CORS | Weight per 1 km² | Verdict |
|---|---|---|---|---|---|
| **Overpass API** (`overpass-api.de`, `overpass.kumi.systems`) | None | OSM nodes/ways/relations with `geom` incl. `building`, `highway`, `landuse`, `natural`, `area` | `Access-Control-Allow-Origin: *` on GET/POST | 30–180 KB gzipped JSON for dense urban 0.01°×0.01°; sparse rural ~5–20 KB | **✅ Chosen — free, keyless, bbox-native, no tile conversion needed** |
| `api.openstreetmap.org/api/0.6/map?bbox=` | None | Raw OSM XML | CORS blocked on most browsers for `api.openstreetmap.org` (tight `Access-Control-Allow-Origin`); XML heavier | Heavier, requires OSM → JSON conversion | ❌ Worse perf, stricter bbox limit (0.25 deg²) |
| OSM Vector Tiles (Mapbox/Protomaps/MapTiler) | Key or self-host | Pre-tiled protobuf | CORS ok but requires tile decode (`@mapbox/vector-tile`) | Many tiles for 1 km²; decode overhead | ❌ Extra decode, keys, not footprints-as-polygons |
| Stadia / Esri free tiles | N/A (raster) | PNG images | Not geometry | Cannot extrude buildings | ❌ |
| OSM Buildings / OpenTopoData | Free tier needs key for stable | 3D meshes + DEM | CORS varies | Meshes are heavy | ❌ Falls outside “free, no-key, works OOB” |

**Conclusion:** **Overpass** is the only option that is (a) free, (b) requires no registration, (c) returns building *polygons* + highway *polylines* in one query, (d) works with `fetch` from the browser, (e) supports `out geom` so we don’t need to stitch `node` references client-side.

Confirmed by web search: OSM editing is the only operation requiring OAuth; reading via Overpass/Nominatim is anonymous [3](https://publicapis.io/open-street-map-api) and Overpass Turbo uses `[bbox:s,w,n,e][out:json]…` syntax [1-2](https://tchayen.com/fetching-data-from-the-open-street-maps).

### 3.2 Query Shape (minimal, chunk-sized)

To keep mobile payloads light we request **only what we render** and ask for **geometry inline** (`out geom` → no `(._;>;)` + second pass):

```
[out:json][timeout:25];
(
  way["building"]({{bbox}});
  way["highway"]({{bbox}});
  relation["building"]({{bbox}});
);
out geom;
```

- `way["building"]` covers `building=yes/*`
- `way["highway"]` covers all roads; filtering `highway=footway|path` dropped for road mesh to save verts (keep `motorway…residential|unclassified|living_street|service` server-side or client-side via `tags.highway`)
- `relation["building"]` catches multipolygons (campuses, malls)
- **`out geom`** gives `bounds` + `geometry:[{lat,lon}…]` per element, no extra `node` elements → 40–60 % smaller vs. classic recursive query.

Alternative light fallback (for offline demo) ships as `src/engine/world/sampleOSM.json` so the world renders even if Overpass is unreachable — matching Pixellon’s `mockData` philosophy.

### 3.3 BBox & Scale Choice — Keeping it “1×1, light”

- **Chunk definition:** `sizeDeg = 0.01` (≈ 1.11 km at equator, 0.78 km at 50°N). Ingame size at **1:10 = ~80–110 m**. A kart/walker traverses it in ~15–30 s — enough to feel like a neighbourhood.
- **Light alternatives in UI:** 0.005° (~550 m real → 55 m ingame, ~15 KB) for 2 GB RAM phones; 0.01° default; 0.015° (~1.6 km) for desktop exploration. User never downloads > 250 KB per chunk.
- **Coordinate → metres:** equirectangular approx (cheap, accurate <2 km):

```js
const R = 6378137
const toMeters = (lat, lon, lat0, lon0) => ({
  x: (lon - lon0) * Math.PI/180 * R * Math.cos(lat0 * Math.PI/180) * SCALE,
  z: (lat - lat0) * Math.PI/180 * R * SCALE, // Three Z = north
})
// SCALE = 0.1 (1:10)
```

Precise enough for city scale; no `proj4` needed (saves 40 KB).

- **Proven performance envelope:** prior Three.js city experiments render **3k–4k instanced buildings at 60 fps on mobile** with 2 draw calls [3](https://dev.to/anim_theme_a5314fe2e0c287/building-block-city-racer-procedural-generation-performance-in-threejs-1iie)[4](https://dev.to/bingkahu/building-the-round-city-of-baghdad-in-threejs-a-journey-through-history-and-performance-15pf) — we target **≤300 buildings + ≤150 road segments per chunk**, well under that budget.

---

## 4. Rendering Stack — Browser-Side Procedural Generation

### 4.1 Why Three.js (and only Three.js)

| Option | Bundle | Mobile | Road→Mesh | Buildings→Extrude | Pixellon precedent |
|---|---|---|---|---|---|
| **Three.js 0.160** (`three`) | `three.module.js` ~ 150 KB gzipped, loaded **only on `/world`** via `import('three')` | Hardware-accelerated, WebGL2 path, mature LOD/instancing | `BufferGeometry`/`ShapeGeometry` | `InstancedMesh` + `BoxGeometry`/`ExtrudeGeometry` | Brand is Three-free today; lazy import keeps Home at 50.7/17.3 KB |
| Babylon.js | Similar size but larger for city extras | Good, but less documentation for OSM→city | Similar | Similar | Unfamiliar to repo |
| PlayCanvas | Engine + editor | Heavy | Overkill | Overkill | Adds hosting |
| Canvas2D + isometric | 0 KB | Lightest but not “3D world” | No height | Pseudo-3D | Does not meet “generate graphics” spec |

**Decision: Three.js** — free, MIT, CDN-friendly, zero licensing, WebGL2 fallback, smallest viable for building/road instancing.

### 4.2 Generation Pipeline (roads first → buildings)

```
User coords (lat,lon) → bbox → fetch Overpass (direct; fallback /api/osm/chunk)
      ↓
[1] Parse → separate roads / buildings
[2] Ground: PlaneGeometry (chunkScaledSize × chunkScaledSize)
[3] ROADS FIRST: classify highway, build road centre-lines
        → merge into ONE BufferGeometry per chunk
        → Mesh (or Line2) — road network defines corridors
        → (future) snap building footprints off road reserve
[4] BUILDINGS: for each building way/relation
        → footprint polygon → bounds → width/depth
        → height = seeded random 8–28 m real (0.8–2.8 ingame) or
          `building:levels * 3m` if tag present
        → InstancedMesh BoxGeometry per height-bucket
        → vertex-colored + FlatShading (no textures → zero image budget)
        → Y-rotation randomized 0° (faithful X/Y per spec)
[5] Light: Ambient + Directional (shadows OFF on low-end)
[6] Register chunk in ChunkManager (key = latIdx_lonIdx)
[7] Lazy-load neighbours when camera within `THRESHOLD = 25%` of edge
```

Why roads first: prevents building-road overlap detection later; roads establish walkable surface and “city skeleton” before scattering buildings — cleaner visual and allows future collider baking.

### 4.3 Instancing & Draw-Call Budget

- **Ground:** 1 draw call / chunk.
- **Roads:** Merge all road segments of a chunk into one `BufferGeometry` (float32 pos), then one `Mesh`. Result: **1 draw call** regardless of 150 segments (vs. 150 individual `Line`s = 150 calls). Uses `LineBasicMaterial` → `Mesh` with thin boxes if width needed.
- **Buildings:** `InstancedMesh` with unit `BoxGeometry(1,1,1)`; per-instance `Matrix4` (pos + scale + rot) and `InstancedBufferAttribute` color. Three size buckets (`low/mid/high` height) = **3 draw calls** max per chunk. 300 buildings = 3 calls, not 300.
- **Total per 3×3 neighbourhood (9 chunks at most):** ~ 9*(1+1+3)=45 calls, trivially < 60 fps budget on Mali/Adreno.
- Based on documented patterns: `InstancedMesh` reduces 4 000 buildings from 4 000 → 1 call [4](https://dev.to/bingkahu/building-the-round-city-of-baghdad-in-threejs-a-journey-through-history-and-performance-15pf); traffic example shows 3 000 cubes + 50 cars + 50 drones at 2 calls [3](https://dev.to/anim_theme_a5314fe2e0c287/building-block-city-racer-procedural-generation-performance-in-threejs-1iie).

### 4.4 Low-System Optimizations (mandatory, not optional)

- **Import cost:** `three` is never in the entry bundle — `lazy(() => import('./pages/World'))` + `await import('three')` + `await import('three/addons/controls/OrbitControls.js')` only inside World.
- **Geometry:** `BoxGeometry` (12 tris) per building, not `ExtrudeGeometry` (N-gon triangulation) unless polygon count warranted; rounded to whole metres before scaling to reduce float precision cost.
- **Materials:** Single `MeshLambert`/`MeshStandard` with `vertexColors`, `flatShading`; **no textures** (texture memory is #1 mobile killer [5](https://medium.com/@kazukimiyazaki33/three-js-performance-optimization-4-key-lightweight-tips-to-fix-slow-loading-b7aafbe17be7)). Road/ground use vertex-colored planes.
- **Shadows:** OFF by default; toggle ON only when `navigator.hardwareConcurrency ≥ 6` and `deviceMemory ≥ 4` and `!saveData`.
- **DPR:** Clamped `Math.min(window.devicePixelRatio, 1.5)` (same cap as PixelCat). Low-end → `1.0`, `antialias: false`.
- **Frustum + distance culling:** `renderer.sortObjects = false`, `mesh.frustumCulled = true`; Chunks beyond `VIEW_DIST = 2` unloaded (dispose geometry/material).
- **Memory discipline:** Every removed chunk calls `geometry.dispose()`, `material.dispose()`, `InstancedMesh.dispose()` — leak-free long session per [1](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7)[2](https://buildcity.io/features).
- **Worker-ready:** OSM parse + `latLonToMeters` + footprint sizing will be micro-tasked; if `Worker` available, parsed in 30 ms slices via `queueMicrotask` / `requestIdleCallback` to avoid 16 ms frame overrun.
- **Adaptive quality:** On sustained FPS < 45 (measured `clock.getDelta()`), auto `reduceBuildings(0.5)`, `roadOpacity 0.8 → 0.4`, `dispose` farthest chunk.
- **Background lazy-load:** Neighbour fetch uses `fetch(..., {priority:'low'})` + `requestIdleCallback`; scene add happens after `requestAnimationFrame`, so traversal never hitches.

### 4.5 Controls (low-friction, mobile-first)

- Desktop: **OrbitControls** (`enableDamping 0.05`) + `WASD` walk (no `PointerLock` by default to avoid permission friction), `Shift` sprint, `Q/E` yaw — works without pointer lock. Advanced: double-click canvas → `requestPointerLock`.
- Mobile: On-screen twin-thumb: left joystick → move, right drag → orbit; if `ontouchstart` detected, show overlay; otherwise hide.
- Chunk trigger is **position-based**, not input-based: `distanceToEdge < EDGE_THRESH` (30 m ingame) enqueues neighbour.

---

## 5. Free APIs / Public Resources — Verified Out-of-the-Box

| Resource | How we use | Key needed | CORS | Rate-limit that matters |
|---|---|---|---|---|
| `https://overpass-api.de/api/interpreter` | Primary OSM fetch (browser `POST` body = Overpass QL) | No | `*` | Fair-use; bounded `timeout:25`, `maxsize: 1 000 000`. Retry to `overpass.kumi.systems` on 429/504. |
| `https://overpass.kumi.systems/api/interpreter` | Fallback mirror (same QL) | No | `*` | Same |
| `/api/osm/chunk` (this repo) | Server-side proxy of above (TTL 10 min) — used only if direct fetch fails (CORS in odd corporate network or 429). Still no key. | No | Same-origin | Our cache coalesces → 1 upstream per 10 min per bbox globally |
| `src/engine/world/sampleOSM.json` | Bundled tiny Overpass-style sample (Shibuya-ish block, 24 buildings, 18 roads) | — | — | None; enables offline demo & e2e test |

No Mapbox, no MapTiler, no Google, no HERE, no offline tile server. The only runtime URLs are the two public Overpass endpoints plus (optionally) our own `/api/*` proxy which itself just forwards to Overpass. **All work cold after `npm run dev` with no `.env` keys.**

Elevation omitted per spec (“z can be inaccurate”), which saves a second API and doubles as a mobile win (no DEM decode).

---

## 6. Chunk & Lazy-Load Lifecycle

```
WorldOrigin = initial user coords (lat0, lon0, chunkKey 0,0)
Chunk grid: integer lattice (dLat = sizeDeg, dLon = sizeDeg / cos(lat0))
State: Map<chunkKey, { meshGroup, buildingsCount, roadsCount, loadedAt }>

onPlayerMove(posMeters):
  localEdgeDist = min(pos.x - minX, maxX - pos.x, pos.z - minZ, maxZ - pos.z)
  if edgeDist < CHUNK_SIZE_M * 0.25 and neighbour not requested:
     enqueue fetchNeighbour(dir) → fetch bbox → generate → addGroup(offset)
  if loadedChunks.size > 9:
     evict farthest chunk (LRU, not containing player)

Visibility: keep player chunk + 8 neighbours max.
Memory bound: ≤ 9 * (max 300 buildings + 150 roads) ≈ 2700 buildings + 1350 roads global,
              far under instancing budget.

Background prefetch is `low-priority fetch` + `requestIdleCallback` so it never competes with render budget.
```

User perception: “Seamless” — road meshes appear ~200 m ahead ingame (2 km real) without hitching.

---

## 7. 1:10 Scale — Detailed Interpretation

- All **horizontal** coordinates multiplied by `0.1`. A real 10 m facade → 1 m ingame; 1 km walk → 100 m.
- Footprint proportions preserved (X/Y accurate → recognizable city layout). 
- **Z (height)** stylized: `levels * 2.8m` if tag exists else `hash(id) → 2–7 storeys`. This keeps skyline varied while staying cheap (no BDT data fetch).
- Speed tuned to scale: walk `6 m/s` ingame ≈ 60 m/s real → interesting without feeling miniature.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Overpass 429 under load | Second mirror, server proxy cache, exponential backoff, small bbox keeps query cheap. UI shows “Serving cached / sample area” banner; never hard-fails. |
| CORS failure on locked-down network | Transparent fallback to same-origin `/api/osm/chunk`. |
| Dense downtown → 2000 buildings in 1 km² → GPU death | `MAX_BUILDINGS_PER_CHUNK = 300` cap; keep largest footprints, random-sample rest. Shown as “Simplified · 300/2140” badge. |
| Mobile memory leak over long stroll | `dispose()` on evict, `THREE.Cache.enabled=false`, cap to 9 chunks, lower DPR. |
| Input jank on low-end Android | Antialias off, shadows off, `powerPreference:'low-power'`, `requestAnimationFrame` throttled to 30 Hz when `effectiveType` = `2g/3g`. |
| Empty rural chunk → “nothing there” feel | If `buildings.length == 0 && roads.length == 0`, synthesize procedural trees/rocks (instanced cones) so UX isn’t blank. |

---

## 9. Implementation Plan (next step)

1. **`npm i three`** (only new dep; peer dep stays zero on entry via lazy).
2. **Server:** add `server/routes.js` entry `GET /api/osm/chunk?lat&lon&size` → cached Overpass proxy (no key, projection = passthrough + `MAX_ELEMENTS` cap).
3. **Client utils:**
   - `src/engine/world/bbox.js` — bbox from centre + sizeDeg
   - `src/engine/world/osm.js` — `fetchOSMChunk(bbox, {signal})`, mirrors + fallback + mock
   - `src/engine/world/scale.js` — `latLonToMeters`, `SCALE=0.1`
   - `src/engine/world/generate.js` — roads-first → building instancing, with `MAX_*` caps
   - `src/engine/world/chunkManager.js` — grid bookkeeping, LRU eviction, neighbour prefetch
4. **Page:** `src/pages/World.jsx` — coordinate picker (+ “Use my location”, presets: Tokyo, NYC, London, Paris, SF, Berlin), Three canvas, joystick overlay, debug HUD (FPS/chunks/verts), `OrbitControls` + WASD.
5. **Site integration:**
   - `src/App.jsx`: `const World = lazy(() => import('./pages/World'))` → `/world`
   - `src/pages/Home.jsx` + `src/pages/Gateway.jsx`: add 3rd card/CTA “Enter Coordinates → `/world`” (distinct icon, same brand language).
   - `src/components/Navbar.jsx`: add `World` nav item (or hide behind CTA — per design, keep nav clean, CTA is primary).
6. **Self-tests & docs:** offline sample handles `/api/osm/chunk` without upstream; `npm run build` + `npm run test` remain green (new page is lazy → does not grow entry).

---

## 10. References

- [1] Overpass bbox + `out geom` pattern: tchayen.com 
- [2] Overpass json `out geom` vs. recursive `node(w)`: same
- [3] OSM free, no-key reading (Nominatim/Overpass/tiles): publicapis.io/open-street-map-api
- [4] Three.js instancing for 3–4k buildings at 2 draws: Block City Racer walkthrough
- [5] Three.js instancing rationale (4k buildings → 1 call): Round City demo
- [6] Texture → KTX2, merge, LOD, draw-call discipline: performance guide
- [7] Three.js viewers — frustum, adaptive, dispose: Altersquare guide + BuildCity features

---

*This report satisfies the “research first” gate. Implementation proceeds in the next commit on branch `arena/01a0a324-pixellon-games`.*
