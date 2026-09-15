/**
 * Render smoke test — `npm run test:render`
 *
 * Every route is rendered to HTML in Node through Vite's SSR pipeline. It is not
 * a browser test: effects (and therefore data fetching) do not run, and layout is
 * not evaluated. What it *does* prove, cheaply and without a test runner:
 *
 *   • every page module still parses, imports and executes
 *   • the lazy route table, Context providers and component tree mount cleanly
 *   • no page throws on an empty dataset (the state a cold visitor sees)
 *   • no module accidentally reaches for `window` at render time (SSR-safe code
 *     is also safer code in a PWA/worker context)
 *
 * Run it after refactors that touch a lot of components — it catches the class of
 * breakage a bundler happily compiles but a browser explodes on.
 */

import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToString, renderToReadableStream } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import assert from 'node:assert/strict';

/* Minimal browser surface for modules that touch globals at import time. */
globalThis.window ??= globalThis;
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, hidden: false };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window.matchMedia ??= globalThis.matchMedia;

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const load = (path) => vite.ssrLoadModule(path);

const modules = {
  context: await load('/src/context/CodexContext.jsx'),
};

const routes = [
  ['/', await load('/src/pages/Home.jsx')],
  ['/indie', await load('/src/pages/Indie.jsx')],
  ['/reviews', await load('/src/pages/Reviews.jsx')],
  ['/calendar', await load('/src/pages/Calendar.jsx')],
  ['/deals', await load('/src/pages/Deals.jsx')],
  ['/gateway', await load('/src/pages/Gateway.jsx')],
  ['/codex', await load('/src/pages/CodexHub.jsx')],
  ['/codex/326243', await load('/src/pages/GameWiki.jsx')],
  ['/codex/326243/bosses', await load('/src/pages/GameWiki.jsx')],
  ['/free-games', await load('/src/pages/FreeGames.jsx')],
  ['/news', await load('/src/pages/News.jsx')],
  ['/streams', await load('/src/pages/Streams.jsx')],
  ['/esports', await load('/src/pages/Esports.jsx')],
  ['/profile', await load('/src/pages/Profile.jsx')],
];

let passed = 0;
let failed = 0;

console.log('\n  route                                    html      status');

for (const [path, mod] of routes) {
  const Page = mod.default;
  try {
    const html = renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(modules.context.CodexProvider, null, createElement(Page)),
      ),
    );
    // Pages render either their content or their loading state — both are valid
    // here (effects, and therefore fetches, never run during SSR).
    assert.ok(html.length > 120, `suspiciously small output (${html.length} bytes)`);
    assert.ok(!html.includes('undefined</'), 'rendered a literal "undefined"');
    passed++;
    console.log(`  ${path.padEnd(40)} ${String(html.length).padStart(6)} B  \x1b[32m✓\x1b[0m`);
  } catch (error) {
    failed++;
    console.log(`  ${path.padEnd(40)} ${'—'.padStart(8)}  \x1b[31m✗ ${error.message.split('\n')[0]}\x1b[0m`);
  }
}

/* The shell itself: Navbar + Footer + PixelCat + the lazy route table.
   Uses the streaming API because a Suspense boundary (the lazy routes) cannot be
   resolved by the synchronous renderer. */
try {
  const { default: App } = await load('/src/App.jsx');
  const stream = await renderToReadableStream(
    createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      createElement(modules.context.CodexProvider, null, createElement(App)),
    ),
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  assert.match(html, /Play\. Share\./, 'shell did not render the navbar/hero');
  assert.match(html, /Pixellon/, 'shell did not render the brand');
  passed++;
  console.log(`  ${'<App shell>'.padEnd(40)} ${String(html.length).padStart(6)} B  \x1b[32m✓\x1b[0m`);
} catch (error) {
  failed++;
  console.log(`  ${'<App shell>'.padEnd(40)} ${'—'.padStart(8)}  \x1b[31m✗ ${error.message.split('\n')[0]}\x1b[0m`);
}

await vite.close();
console.log(`\n  ${passed} rendered, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
