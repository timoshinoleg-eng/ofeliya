import { defineConfig } from 'vite';

// base './' — относительные пути, чтобы билд работал на любом HTTPS-хостинге
// (VK Cloud / Yandex Cloud / GitHub Pages), как требует платформа мини-приложений MAX.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[/\\]node_modules[/\\]phaser[/\\]/.test(id)) return 'vendor-phaser';
          // P-07: payment domain chunk. Loaded on demand (storefront entry,
          // boot-time pending-purchase drain). storefrontVisibility stays in
          // the entry chunk — MenuScene needs it synchronously to decide
          // whether the shop chip exists at all.
          if (
            /[/\\]src[/\\]game[/\\]shop[/\\]/.test(id) &&
            !/[/\\]storefrontVisibility\.ts$/.test(id)
          ) {
            return 'shop';
          }
          return undefined;
        },
      },
    },
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
