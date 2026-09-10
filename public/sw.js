/**
 * OFELIYA Service Worker (R2 — PWA). Стратегия:
 *
 * - App shell (index, manifest, иконки, шрифты) — pre-cache на install;
 * - Навигации — network-first с фолбэком на кэшированный index.html
 *   (offline-запуск меню);
 * - /assets/* (JS/CSS Phasera) — stale-while-revalidate (кэш + тихое обновление);
 * - /audio/* — НЕ кэшируем (11MB стриминг — кэш только по сети, как и раньше);
 * - Чужие origin — не трогаем.
 *
 * Версионирование: при смене VERSION старые кэши чистятся на activate.
 */
const VERSION = 'ofeliya-v1';
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
  if (url.origin !== self.location.origin) return; // только свои запросы

  const path = url.pathname;

  // Аудио — стриминг по сети, кэш не трогаем (объём 11MB).
  if (path.startsWith('/audio/')) return;

  // Навигация: network-first, offline → index.html.
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

  // Assets и остальное: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && (path.includes('/assets/') || path.startsWith('/fonts/'))) {
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
