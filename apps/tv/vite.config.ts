import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// SweamTV builds INTO the web app's dist at /tv/ so the one Worker serves
// both: build @sweam/web first, then @sweam/tv (emptyOutDir only clears
// dist/tv). In dev, Vite serves the app at http://localhost:5320/tv/ and
// proxies API + media to wrangler (SWEAM_API_PORT overrides the port so this
// session's stack can run beside another session's).
const apiPort = process.env.SWEAM_API_PORT ?? '8787';
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  base: '/tv/',
  plugins: [react()],
  resolve: {
    alias: {
      '@sweam/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: '../web/dist/tv',
    emptyOutDir: true,
  },
  server: {
    port: 5320,
    proxy: {
      '/api': apiTarget,
      '/media': apiTarget,
    },
  },
});
