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
  // Render QA serves the production bundle through `vite preview`.
  // Vite 6 blocks unknown Host headers by default, so allow only the dedicated
  // Strain Zero QA hostname instead of disabling host validation globally.
  preview: {
    allowedHosts: ['ofeliya-strain-zero-main-qa.onrender.com'],
  },
});
