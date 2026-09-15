import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import apiPlugin from './server/vite-plugin.js'

/**
 * Pixellon build config.
 *
 * Three changes from the template config, all cost/perf driven:
 *
 * 1. `apiPlugin()` — mounts `server/` (the cached, key-holding API layer) into
 *    BOTH dev and preview. The old config proxied third-party hosts from the dev
 *    server only, so `/api/steam/...` would 404 in any real deployment and every
 *    key had to be `VITE_`-prefixed (i.e. shipped to the browser).
 *
 * 2. Chunk policy — the app used to be one 648 KB bundle. `codeSplitting.groups`
 *    keeps React, the animation library, the markdown stack and the icon set in
 *    separate, cacheable chunks. Combined with the lazy routes in `App.jsx`,
 *    visiting Home no longer downloads the wiki renderer.
 *
 * 3. `allowedHosts` — sandboxed and proxied environments send a Host header the
 *    dev server would otherwise reject. Without this the preview 403s.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],

  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true, // proxied preview hosts (see docs/SCALE-PLAN.md)
  },

  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },

  build: {
    target: 'es2020', // modern devices only; no legacy transforms nobody needs
    cssCodeSplit: true,
    sourcemap: false,
    // Anything above this is a regression we want to notice in CI.
    chunkSizeWarningLimit: 250,
    reportCompressedSize: true,
    rolldownOptions: {
      output: {
        // Keep the heavy libraries in their own long-lived chunks. They change
        // far less often than app code, so a deploy invalidates only app chunks
        // and returning visitors re-download ~2 KB instead of ~600 KB.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)/, priority: 40 },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)/, priority: 35 },
            {
              name: 'markdown',
              test: /node_modules[\\/](react-markdown|remark|micromark|mdast|unified|hast|vfile|unist|property-information|space-separated-tokens|comma-separated-tokens|character-entities|decode-named-character-reference|trim-lines|devlop|bail|trough|is-plain-obj|zwitch|longest-streak|markdown-table|ccount|escape-string-regexp|parse-entities|stringify-entities)/,
              priority: 30,
            },
            { name: 'icons', test: /node_modules[\\/]lucide-react/, priority: 25 },
            { name: 'vendor', test: /node_modules/, priority: 10, minSize: 20_000 },
          ],
        },
      },
    },
  },
})
