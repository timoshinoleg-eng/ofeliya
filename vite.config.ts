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
    // Превью-хосты платформы (e2b.app и др.) должны проходить без 403.
    allowedHosts: true,
    // Дев: клиент шлёт относительные /api/* — проксируем на score-сервер.
    // Если сервер не запущен, запросы просто 502/404, игра не страдает.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
