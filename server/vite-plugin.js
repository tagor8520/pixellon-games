/**
 * Vite plugin: mounts the API into `vite dev` AND `vite preview`.
 *
 * Without this the site only "works" in development: the old config proxied
 * third-party hosts from the dev server, so a production build shipped
 * unreachable `/api/steam/...` URLs. Mounting the same router in both servers
 * means dev, preview and production run the *same* code path with the same
 * caching and the same key custody.
 *
 * Env is loaded with Vite's own loader (prefix `''` = every variable) so
 * `.env`, `.env.local` and `.env.[mode]` all behave as expected, but nothing
 * gains the `VITE_` prefix and therefore nothing leaks into the client bundle.
 */

import { createApi } from './api.js';
import { buildEnv } from './lib/env.js';

export default function apiPlugin() {
  let api;

  const mount = (server, root) => {
    const env = buildEnv({ root, base: process.env });
    // `loadEnv` also picks up mode-specific files Vite knows about.
    api = createApi({ env });

    server.middlewares.use(async (req, res, next) => {
      try {
        if (await api.handle(req, res)) return;
      } catch (error) {
        server.config.logger.error(`[api] unhandled: ${error?.stack || error}`);
      }
      next();
    });

    server.httpServer?.once('listening', () => {
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : '';
      server.config.logger.info(
        `  \x1b[36m➜\x1b[0m  API:   \x1b[36mhttp://localhost:${port}/api/health\x1b[0m (cached, keys server-side)`,
      );
    });
  };

  return {
    name: 'pixellon-api',
    apply: () => true,
    configResolved(config) {
      this.root = config.root;
      this.mode = config.mode;
    },
    configureServer(server) {
      mount(server, server.config.root);
    },
    configurePreviewServer(server) {
      mount(server, server.config.root);
    },
  };
}
