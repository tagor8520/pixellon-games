/**
 * contentIndex — the "map" for a catalog that can grow without a redeploy.
 *
 * The site currently *derives* every Codex page from third-party APIs. That
 * does not scale in either direction:
 *
 *   • cost   — N page views = N upstream calls (bounded by cache TTLs, but the
 *              first visitor per TTL window always pays)
 *   • control— you cannot author a boss table, a build guide or a walkthrough
 *              for a game you do not own the upstream record for
 *   • size   — `import x from './pages/all-games.json'` would put the entire
 *              catalog in the main bundle
 *
 * The content layer solves that with a manifest + sharded, lazily imported
 * documents:
 *
 *   content/index.json            tiny manifest: id → metadata (no page bodies)
 *   content/index-shards/a.json   search shards, loaded per first character
 *   content/games/<id>.json       one file per game → its own JS chunk
 *
 * Consequences: the browser ships ~0 bytes for content it never opens; a wiki
 * page load is one small JSON fetch served from the CDN (immutable, hashed);
 * and search runs locally against a shard instead of a billed upstream call per
 * keystroke. Adding the 5 000th game costs a row in the manifest, not bundle
 * size.
 *
 * Generate/refresh with `npm run content:index` (see scripts/build-content-index.mjs).
 */

/**
 * Eager-ish registry of content modules: Vite turns each JSON file into its own
 * dynamic-import chunk, so nothing here is downloaded until `loadGameContent`
 * asks for it. (`eager: false` is the default and the whole point.)
 */
const gameModules = import.meta.glob('../../content/games/*.json')

const GAME_PREFIX = '../../content/games/'

/** Strip the glob path down to the bare id used as a key everywhere else. */
const idFromPath = (path) => path.slice(GAME_PREFIX.length).replace(/\.json$/, '')

const moduleIds = new Set(Object.keys(gameModules).map(idFromPath))

let manifestPromise = null
const shardPromises = new Map()

/** The manifest: { version, generatedAt, games: { [id]: metadata } } */
export function loadManifest() {
  manifestPromise ??= import('../../content/index.json')
    .then((mod) => mod.default ?? mod)
    .catch(() => ({ version: 1, games: {} }))
  return manifestPromise
}

/** Load a search shard (one letter) — cheaper than the whole manifest for search. */
function loadShard(letter) {
  const key = letter.toLowerCase()
  if (!shardPromises.has(key)) {
    shardPromises.set(
      key,
      import(`../../content/index-shards/${key}.json`)
        .then((mod) => mod.default ?? mod)
        .catch(() => null),
    )
  }
  return shardPromises.get(key)
}

/** Does this id have authored, local content? (checked without any download) */
export const hasLocalContent = (gameId) => moduleIds.has(String(gameId))

/**
 * Load one game's authored content. Returns null when there is none — the
 * caller then falls back to the API-derived page.
 */
export async function loadGameContent(gameId) {
  const key = `${GAME_PREFIX}${gameId}.json`
  const loader = gameModules[key]
  if (!loader) return null
  const mod = await loader()
  return mod?.default ?? mod
}

/**
 * Local search. Returns manifest-level rows (id, title, genre, platforms) —
 * enough to render results without touching the network.
 */
export async function searchContentIndex(query, { limit = 8 } = {}) {
  const term = String(query || '').trim().toLowerCase()
  if (term.length < 2) return []

  const shard = await loadShard(term[0])
  const rows = shard?.games ? Object.entries(shard.games) : Object.entries((await loadManifest()).games || {})

  return rows
    .map(([id, meta]) => ({ id, ...meta }))
    .filter(({ title = '', genre = '', tags = [], aliases = [] }) => {
      const haystack = `${title} ${genre} ${tags.join(' ')} ${aliases.join(' ')}`.toLowerCase()
      return haystack.includes(term)
    })
    .slice(0, limit)
}

/** Everything we know locally, for "browse by letter" UIs. */
export async function listLocalContent({ limit = 100 } = {}) {
  const manifest = await loadManifest()
  return Object.entries(manifest.games || {})
    .map(([id, meta]) => ({ id, ...meta }))
    .slice(0, limit)
}

export async function contentStats() {
  const manifest = await loadManifest()
  const games = Object.keys(manifest.games || {}).length
  return {
    manifestGames: games,
    playableModules: moduleIds.size,
    generatedAt: manifest.generatedAt || null,
    // Bytes of page bodies the browser has NOT downloaded, by construction.
    deferredDocuments: Math.max(0, moduleIds.size),
  }
}

export default {
  loadManifest,
  loadGameContent,
  searchContentIndex,
  listLocalContent,
  hasLocalContent,
  contentStats,
}
