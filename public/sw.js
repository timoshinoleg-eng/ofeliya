/**
 * OFELIYA Service Worker — Strain Zero MAX RC.
 *
 * - App shell: pre-cache on install;
 * - navigation: network-first with cached index fallback;
 * - assets/fonts: stale-while-revalidate;
 * - audio: network only;
 * - cache cleanup is scoped to OFELIYA only.
 */
const VERSION = 'ofeliya-strain-zero-rc1';
const CACHE_PREFIX = 'ofeliya-';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './fonts/chakra-petch-1.woff2',
  './fonts/chakra-petch-2.woff2',
];

const AUDIO_PREFIX = new URL('./audio/', self.registration.scope).pathname;
const ASSET_PREFIX = new URL('./assets/', self.registration.scope).pathname;
const FONT_PREFIX = new URL('./fonts/', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
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

  if (path.startsWith(AUDIO_PREFIX)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then((hit) => hit || new Response('offline', { status: 503 }))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && (path.startsWith(ASSET_PREFIX) || path.startsWith(FONT_PREFIX))) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
