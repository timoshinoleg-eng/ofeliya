/**
 * OFELIYA Service Worker — Strain Zero MAX RC.
 *
 * - App shell: pre-cache on install;
 * - navigation: network-first with cached index fallback;
 * - assets/fonts: stale-while-revalidate;
 * - audio/video: network only (browser HTTP cache handles media/range requests);
 * - cache cleanup is scoped to OFELIYA only.
 */
const VERSION = 'ofeliya-__OFELIYA_RELEASE__';
const CACHE_PREFIX = 'ofeliya-';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
  './',
  './index.html',
  './runtime-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './fonts/chakra-petch-1.woff2',
  './fonts/chakra-petch-2.woff2',
];

const AUDIO_PREFIX = new URL('./audio/', self.registration.scope).pathname;
const VIDEO_PREFIX = new URL('./video/', self.registration.scope).pathname;
const ASSET_PREFIX = new URL('./assets/', self.registration.scope).pathname;
const FONT_PREFIX = new URL('./fonts/', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      for (const asset of SHELL) {
        const response = await fetch(asset);
        if (!response.ok) throw new Error(`App shell request failed: ${asset} (${response.status})`);
        await cache.put(asset, response);
      }
      const index = await cache.match('./index.html');
      const html = index ? await index.text() : '';
      const bundledAssets = [...html.matchAll(/(?:src|href)=["']([^"']+\/assets\/[^"']+)["']/g)]
        .map((match) => new URL(match[1], self.registration.scope).toString());
      for (const asset of bundledAssets) {
        const response = await fetch(asset);
        if (!response.ok) throw new Error(`App bundle request failed: ${asset} (${response.status})`);
        await cache.put(asset, response);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && !key.startsWith(VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith(AUDIO_PREFIX) || path.startsWith(VIDEO_PREFIX)) return;

  if (req.mode === 'navigate') {
    const shellIndex = new URL('./index.html', self.registration.scope).toString();
    const network = fetch(req).then((res) => {
      if (res.ok) {
        const persist = caches.open(SHELL_CACHE).then((cache) => cache.put(shellIndex, res.clone()));
        event.waitUntil(persist);
      }
      return res;
    });
    event.respondWith(
      network.catch(() =>
        caches.match(shellIndex).then((hit) => hit || new Response('offline', { status: 503 }))
      )
    );
    return;
  }

  const response = caches.match(req).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res.ok && (path.startsWith(ASSET_PREFIX) || path.startsWith(FONT_PREFIX))) {
        const persist = caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, res.clone()));
        event.waitUntil(persist);
      }
      return res;
    });
  });
  event.respondWith(response);
});
