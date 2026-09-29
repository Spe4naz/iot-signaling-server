import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The panel is served by the signaling server under /panel/ (and proxied
// by nginx in the self-host stack). All assets are produced with that base.
export default defineConfig({
  plugins: [vue()],
  base: '/panel/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      '/panel': 'http://127.0.0.1:3000',
      '/api': 'http://127.0.0.1:3000',
    },
  },
});