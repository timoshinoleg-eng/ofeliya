import { defineConfig } from 'vite';

// base './' — относительные пути, чтобы билд работал на любом HTTPS-хостинге
// (VK Cloud / Yandex Cloud / GitHub Pages), как требует платформа мини-приложений MAX.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
  },
});
