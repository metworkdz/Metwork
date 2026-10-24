/**
 * Browser side of web push: what this device can do, and turning it on/off.
 *
 * iPhone/iPad only deliver web push to the app added to the home screen
 * (iOS 16.4+), so there the state is `needs-install` until it runs standalone.
 * Client-only: every function checks for `window`.
 */

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

/** Members: /api/push/subscription · consultants: /api/consultant/push */
export type PushApi = '/api/push/subscription' | '/api/consultant/push';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // Production registers /sw.js on load; dev doesn't, so register on demand.
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !VAPID) return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask permission, subscribe this device and register it with the server. */
export async function enablePush(api: PushApi, locale: 'fr' | 'en' | 'ar'): Promise<PushState> {
  if (!supported() || !VAPID) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) as BufferSource }));
  const json = sub.toJSON();
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, locale }),
  });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => undefined);
    throw new Error(`push subscribe ${res.status}`);
  }
  return 'on';
}

/** Unsubscribe this device here and on the server (also called on logout). */
export async function disablePush(api: PushApi): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await fetch(api, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return 'off';
}
