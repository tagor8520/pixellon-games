/**
 * Env loading for the server side.
 *
 * Deliberately dependency-free and *server-only*: these values never reach the
 * browser bundle. In the old setup every key was `VITE_`-prefixed, which Vite
 * inlines into the public JS — anyone could read the RAWG key from devtools and
 * spend our quota. Non-prefixed variables are invisible to the client build.
 *
 * Precedence: real environment variables win over `.env` files (so hosting
 * dashboards can override), matching dotenv semantics.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Parse a .env file body into a plain object. Supports quotes, # comments, `export`. */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Merge `.env` + `.env.local` into an object without mutating process.env.
 * @param {{ root?: string, files?: string[] }} [opts]
 */
export function loadEnvFiles({ root = process.cwd(), files = ['.env', '.env.local'] } = {}) {
  const fileValues = {};
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    Object.assign(fileValues, parseEnv(readFileSync(path, 'utf8')));
  }
  return fileValues;
}

/** Build the effective env for the API layer. Server vars take precedence. */
export function buildEnv({ root = process.cwd(), base = process.env, files } = {}) {
  return { ...loadEnvFiles({ root, files }), ...base };
}

/**
 * True when the value looks like a usable credential.
 * Placeholders from `.env.example` ("", "changeme", "…") are rejected so the
 * API reports "not configured" instead of hammering an upstream with junk.
 */
export function hasCredential(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  if (v.length < 8) return false;
  return !/^(your|changeme|placeholder|xxx|todo|<)/.test(v);
}

export default buildEnv;
