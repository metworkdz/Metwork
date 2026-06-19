/* Metwork PWA service worker — minimal installability + offline app shell.
 *
 * Deliberately conservative:
 *   • GET + same-origin only.
 *   • NEVER caches /api/* or any non-GET request (no authenticated data cached).
 *   • Navigations: network-first, falling back to a generic offline shell —
 *     authenticated HTML is never written to the cache.
 *   • Static build assets / icons: cache-first.
 */
// Bump this on any change to caching behaviour: `activate` deletes every cache
// whose name isn't the current one, so a version bump purges the prior shell in
// one pass (clears any stale asset graph a long-lived standalone client pinned).
const CACHE = 'metwork-shell-v2';
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
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => {
            // Only cache real successes. Caching a 404/redirect for a purged
            // chunk would pin a broken asset; instead we let the failure
            // surface so the client's chunk-load recovery can hard-reload.
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          })
          // Never resolve `respondWith` with undefined — it must be a Response.
          .catch(() => cached || Response.error());
      }),
    );
  }
});
