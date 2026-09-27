import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
