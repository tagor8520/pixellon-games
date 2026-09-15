#!/usr/bin/env node
/**
 * Content index generator — `npm run content:index`
 *
 * Scans `content/games/*.json` and emits:
 *   content/index.json              manifest (metadata only, no page bodies)
 *   content/index-shards/<a-z|_.json>  per-first-letter search shards
 *
 * Run it whenever content changes (`npm run content:index -- --check` in CI to
 * fail the build when the manifest is stale). The manifest is what lets the app
 * know about 5 000 games while downloading the body of only the one being read.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const CONTENT_DIR = join(ROOT, 'content');
const GAMES_DIR = join(CONTENT_DIR, 'games');
const SHARDS_DIR = join(CONTENT_DIR, 'index-shards');
const MANIFEST_PATH = join(CONTENT_DIR, 'index.json');
const CHECK = process.argv.includes('--check');

const shardKey = (title = '') => {
  const first = String(title).trim().toLowerCase()[0] || '_';
  return /[a-z0-9]/.test(first) ? first : '_';
};

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

if (!existsSync(GAMES_DIR)) fail(`no content directory at ${GAMES_DIR}`);

const files = readdirSync(GAMES_DIR).filter((f) => f.endsWith('.json'));
const games = {};
const shards = {};
const problems = [];
let bodyBytes = 0;

for (const file of files) {
  const path = join(GAMES_DIR, file);
  const id = file.replace(/\.json$/, '');
  bodyBytes += statSync(path).size;

  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${file}: invalid JSON (${error.message})`);
    continue;
  }

  if (!doc.title) problems.push(`${file}: missing "title"`);
  if (doc.id && String(doc.id) !== id) {
    problems.push(`${file}: filename "${id}" does not match "id": ${doc.id}`);
  }
  const pages = doc.pages ? Object.keys(doc.pages) : [];
  if (!pages.length) problems.push(`${file}: no pages`);

  const meta = {
    title: doc.title || id,
    slug: doc.slug || id,
    genre: doc.genre || '',
    platforms: doc.platforms || [],
    tags: doc.tags || [],
    aliases: doc.aliases || [],
    updated: doc.updated || null,
    pages,
    hasLocalContent: true,
  };

  games[id] = meta;
  const key = shardKey(meta.title);
  shards[key] ??= { games: {} };
  shards[key].games[id] = meta;
}

if (problems.length) {
  console.error('\n  Content problems:');
  for (const problem of problems) console.error(`   • ${problem}`);
  fail(`${problems.length} content problem(s) found`);
}

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: Object.keys(games).length,
  games,
};

const serialise = (value) => `${JSON.stringify(value, null, 2)}\n`;
const manifestJson = serialise(manifest);

if (CHECK) {
  // Compare everything except the timestamp — otherwise the check would fail on
  // every run simply because time passed, and a gate that always fails is a gate
  // everybody learns to ignore.
  const strip = ({ generatedAt, ...rest }) => rest;
  const current = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null;
  if (!current || JSON.stringify(strip(current)) !== JSON.stringify(strip(manifest))) {
    fail('content/index.json is out of date — run `npm run content:index`');
  }
  console.log(`  ✓ content index is up to date (${manifest.count} games)`);
  process.exit(0);
}

mkdirSync(SHARDS_DIR, { recursive: true });
writeFileSync(MANIFEST_PATH, manifestJson);
for (const [key, shard] of Object.entries(shards)) {
  writeFileSync(join(SHARDS_DIR, `${key}.json`), serialise({ version: 1, key, games: shard.games }));
}

const shardBytes = Object.keys(shards).reduce(
  (total, key) => total + statSync(join(SHARDS_DIR, `${key}.json`)).size,
  0,
);

console.log(`\n  ✓ content index built`);
console.log(`    games            ${manifest.count}`);
console.log(`    page bodies      ${(bodyBytes / 1024).toFixed(1)} KB (never shipped in the entry bundle)`);
console.log(`    manifest         ${(manifestJson.length / 1024).toFixed(1)} KB`);
console.log(`    search shards    ${Object.keys(shards).length} → ${(shardBytes / 1024).toFixed(1)} KB total`);
console.log(`    largest shard    ${(Math.max(0, ...Object.keys(shards).map((k) => statSync(join(SHARDS_DIR, `${k}.json`)).size)) / 1024).toFixed(1)} KB\n`);
