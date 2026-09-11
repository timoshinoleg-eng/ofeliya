/**
 * OFELIYA Service Worker (R2 — PWA). Стратегия:
 *
 * - App shell (index, manifest, иконки, шрифты) — pre-cache on install;
 * - Навигации — network-first с фолбэком на кэшированный index.html;
 * - /assets/* — stale-while-revalidate;
 * - /audio/* — не кэшируем;
 * - Чужие origin — не трогаем.
 *
 * VERSION меняется на каждом production routing/cache release, чтобы MAX
 * WebView гарантированно удалял старый shell после activate.
 */
const VERSION = 'ofeliya-v041-r2';
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

// Service worker живёт под deployment prefix (/ofeliya/ в production),
// поэтому нельзя проверять только root-path вроде /audio/.
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
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
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
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
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
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
