# content/ — authored game content (the catalog "map")

This directory is how the Codex scales past what a third-party API can serve.
Nothing here is bundled into the entry chunk: the manifest is small, and each
game document is a separate JSON chunk fetched only when a reader opens it.

```
content/
  index.json                 generated manifest: id → metadata (no page bodies)
  index-shards/e.json        generated search shards, one per first letter
  games/326243.json          one document per game
  games/839629.json
```

Regenerate the manifest after editing or adding documents:

```bash
npm run content:index          # writes index.json + index-shards/
npm run content:index -- --check   # CI: fails when the manifest is stale
```

## Document format

```jsonc
{
  "id": "326243",              // must match the filename; the Codex route id
  "slug": "elden-ring",        // optional, for pretty URLs / aliases
  "title": "Elden Ring",       // required — also drives the search shard letter
  "genre": "Action RPG",
  "platforms": ["PC", "PS5"],
  "tags": ["soulslike"],       // searched
  "aliases": ["ER"],           // searched
  "updated": "2026-09-01",
  "banner": "https://…",       // optional hero image
  "pages": {                   // required, at least one
    "home":     { "title": "Overview", "content": "# Markdown…" },
    "bosses":   { "title": "Boss Checklist", "content": "…" }
  }
}
```

`content` is Markdown (GFM tables supported). Page ids become the URL segment:
`/codex/326243/bosses`.

## How the runtime resolves a page

1. `hasLocalContent(id)` — a lookup in the glob registry, zero bytes downloaded.
2. `loadGameContent(id)` — dynamic `import()` of that one JSON file → its own chunk.
3. Local pages win over API-derived ones, so authored content is authoritative;
   user edits (in `localStorage`) still win over both.
4. No local document → the page falls back to `/api/wiki/:id`, which is the
   cacheable composite described in `docs/ARCHITECTURE.md`.

## Why this shape

| Concern | Consequence of this layout |
| --- | --- |
| Bundle size | Page bodies never enter the entry bundle or any route chunk |
| Upstream cost | Authored pages cost zero API quota; they are static CDN assets |
| Availability | Content survives an upstream outage, rate limit, or API deprecation |
| Search | Local shard search replaces one billed upstream call per keystroke |
| Scale | The 5 000th game adds one manifest row (~120 B), not bundle weight |

## Rules of thumb

- Keep each document under ~50 KB.
- Prefer many small pages over one enormous page — routing is per page.
- Never store credentials, drafts or user data here. This directory is public.
