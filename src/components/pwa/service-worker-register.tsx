'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker (`/sw.js`) for installability + an offline
 * app shell. Production-only — in dev we never register one so Fast Refresh and
 * uncached source maps keep working. Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        // `updateViaCache: 'none'` forces the browser to byte-check /sw.js from
        // the network on every load instead of serving a cached worker — so a
        // fixed SW propagates to iOS Safari instead of being pinned on a stale
        // one. `reg.update()` nudges an immediate check on each visit.
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => { void reg.update(); })
        .catch(() => {
          /* registration is best-effort; never block the app */
        });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
