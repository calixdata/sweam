import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies API and media traffic to the Worker (wrangler dev on
// :8787), so the app is same-origin in development exactly as it is in
// production and no CORS configuration exists anywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/media': 'http://127.0.0.1:8787',
    },
  },
});
