/**
 * Web push — THE sender for phone/desktop notifications of the installed app.
 *
 * Every in-app notification goes out here too (createNotification calls
 * `pushToUser`); consultants, who have no member account, get theirs through
 * `pushToMentor`. Off when the VAPID keys are not set (tests, local dev
 * without keys): every function then returns without doing anything.
 *
 * Security:
 *   • endpoints must be https on a known browser push service, so a crafted
 *     subscription can't make our server POST to an arbitrary or internal URL;
 *   • the click target is a same-origin path only;
 *   • a device that the push service says is gone (404/410) is deleted, and one
 *     failing repeatedly is dropped.
 */
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { clientEnvVars, serverEnvVars } from '@/lib/env';
import { db, type PushSubscriptionRecord } from '@/server/db/store';

export type PushOwner = { type: 'USER' | 'MENTOR'; id: string };

export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path opened on click. */
  url?: string | null;
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string;
}

/** Browser push services (Chrome/Edge/Android, Firefox, Safari/iOS, Windows). */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];
const MAX_PER_OWNER = 10;
const MAX_FAILURES = 5;
const SEND_TIMEOUT_MS = 5000;

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = clientEnvVars.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = serverEnvVars.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails(serverEnvVars.VAPID_SUBJECT || 'mailto:contact@metwork.dz', pub, priv);
    return (configured = true);
  } catch (err) {
    console.error('[push] bad VAPID keys', String(err));
    return (configured = false);
  }
}

/** Only https endpoints on a known push service. */
export function isAllowedEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** A same-origin path, never a full or protocol-relative URL. */
export function safePath(href: string | null | undefined): string {
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return '/';
  return href.slice(0, 500);
}

export async function savePushSubscription(
  owner: PushOwner,
  sub: { endpoint: string; p256dh: string; auth: string },
  locale: 'fr' | 'en' | 'ar',
): Promise<boolean> {
  if (!isAllowedEndpoint(sub.endpoint)) return false;
  const now = new Date().toISOString();
  await db.update((d) => {
    const all = (d.pushSubscriptions ?? []).filter((s) => s.endpoint !== sub.endpoint);
    all.push({
      id: randomUUID(),
      ownerType: owner.type,
      ownerId: owner.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      locale,
      createdAt: now,
      lastSuccessAt: null,
      failures: 0,
    });
    // Keep the newest devices per owner.
    const mine = all.filter((s) => s.ownerType === owner.type && s.ownerId === owner.id);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - MAX_PER_OWNER)).map((s) => s.id));
    d.pushSubscriptions = all.filter((s) => !drop.has(s.id));
  });
  return true;
}

/** Remove a device — only the owner's own endpoint. */
export async function removePushSubscription(owner: PushOwner, endpoint: string): Promise<void> {
  await db.update((d) => {
    d.pushSubscriptions = (d.pushSubscriptions ?? []).filter(
      (s) => !(s.endpoint === endpoint && s.ownerType === owner.type && s.ownerId === owner.id),
    );
  });
}

export async function removeAllPushSubscriptions(owner: PushOwner): Promise<void> {
  await db.update((d) => {
    d.pushSubscriptions = (d.pushSubscriptions ?? []).filter((s) => !(s.ownerType === owner.type && s.ownerId === owner.id));
  });
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('push timeout')), SEND_TIMEOUT_MS))]);
}

/**
 * Send to every device of the owner. Never throws: push is a nice-to-have on
 * top of the in-app notification, it must not break the caller.
 */
export async function sendPush(owner: PushOwner, payload: PushPayload): Promise<void> {
  try {
    if (!isPushConfigured()) return;
    const data = await db.read();
    const subs = (data.pushSubscriptions ?? []).filter((s) => s.ownerType === owner.type && s.ownerId === owner.id);
    if (!subs.length) return;
    const body = JSON.stringify({
      title: payload.title.slice(0, 120) || 'Metwork',
      body: payload.body.slice(0, 240),
      url: safePath(payload.url),
      tag: payload.tag?.slice(0, 64),
    });
    const results = await Promise.all(subs.map(async (s: PushSubscriptionRecord) => {
      try {
        await withTimeout(webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 86_400, urgency: 'high' },
        ));
        return { id: s.id, ok: true, gone: false };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return { id: s.id, ok: false, gone: status === 404 || status === 410 };
      }
    }));
    const now = new Date().toISOString();
    await db.update((d) => {
      const byId = new Map(results.map((r) => [r.id, r]));
      d.pushSubscriptions = (d.pushSubscriptions ?? []).flatMap((s) => {
        const r = byId.get(s.id);
        if (!r) return [s];
        if (r.gone) return [];
        if (r.ok) return [{ ...s, lastSuccessAt: now, failures: 0 }];
        const failures = s.failures + 1;
        return failures >= MAX_FAILURES ? [] : [{ ...s, failures }];
      });
    });
  } catch (err) {
    console.error('[push] send failed', String(err));
  }
}

export const pushToUser = (userId: string, payload: PushPayload) => sendPush({ type: 'USER', id: userId }, payload);
export const pushToMentor = (mentorId: string, payload: PushPayload) => sendPush({ type: 'MENTOR', id: mentorId }, payload);

/** Test hook: forget the cached VAPID state. */
export function resetPushConfigForTests(): void {
  configured = null;
}
