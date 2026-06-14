/* Metwork PWA service worker — minimal installability + offline app shell.
 *
 * Deliberately conservative:
 *   • GET + same-origin only.
 *   • NEVER caches /api/* or any non-GET request (no authenticated data cached).
 *   • Navigations: network-first, falling back to a generic offline shell —
 *     authenticated HTML is never written to the cache.
 *   • Static build assets / icons: cache-first.
 */
const CACHE = 'metwork-shell-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Authenticated / dynamic API traffic is always live — never intercept.
  if (url.pathname.startsWith('/api/')) return;

  // App navigations: network-first, offline shell as a last resort.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  // Immutable build output, icons, and static brand assets: cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request)
            .then((res) => {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
              return res;
            })
            .catch(() => cached),
      ),
    );
  }
});
