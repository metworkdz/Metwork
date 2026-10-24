/**
 * Metwork 2.0 phase D — web push: endpoint allow-list, subscriptions per
 * owner, sending + clean-up of dead devices, the fan-out from in-app
 * notifications, and the subscription routes' access checks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const wp = vi.hoisted(() => ({ send: vi.fn(), setVapid: vi.fn() }));
vi.mock('web-push', () => ({ default: { sendNotification: wp.send, setVapidDetails: wp.setVapid } }));
vi.mock('@/lib/env', () => ({
  clientEnvVars: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub' },
  serverEnvVars: { VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:t@x.dz' },
}));

let actor: { id: string; role: string } | null = null;
let consultant: string | null = null;
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async (roles: string[]) => actor && roles.includes(actor.role)
    ? { ok: true, user: actor }
    : { ok: false, response: new Response('forbidden', { status: 403 }) }),
}));
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => consultant ? { ok: true, mentorId: consultant } : { ok: false, response: new Response('no', { status: 401 }) }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: vi.fn(async () => true) }));

import { db } from '@/server/db/store';
import { isAllowedEndpoint, pushToMentor, pushToUser, resetPushConfigForTests, safePath, savePushSubscription } from '@/server/notifications/push';
import { createNotification } from '@/server/notifications/create-notification';
import { POST, DELETE } from '@/app/api/push/subscription/route';
import { POST as MENTOR_POST } from '@/app/api/consultant/push/route';

const FCM = 'https://fcm.googleapis.com/fcm/send/abc';
const APPLE = 'https://web.push.apple.com/QWE';
const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const req = (method: string, body: unknown) => new Request('http://x/api/push/subscription', { method, body: JSON.stringify(body) }) as never;

beforeEach(async () => {
  wp.send.mockReset();
  wp.send.mockResolvedValue({ statusCode: 201 });
  resetPushConfigForTests();
  actor = { id: 'u-1', role: 'FREELANCER' };
  consultant = null;
  await db.update((d) => { d.pushSubscriptions = []; d.notifications = []; });
});

describe('endpoint allow-list', () => {
  it('accepts browser push services only', () => {
    expect(isAllowedEndpoint(FCM)).toBe(true);
    expect(isAllowedEndpoint(APPLE)).toBe(true);
    expect(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isAllowedEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedEndpoint('https://fcm.googleapis.com.evil.dz/x')).toBe(false);
    expect(isAllowedEndpoint('https://evilfcm.googleapis.com.attacker.io/x')).toBe(false);
    expect(isAllowedEndpoint('https://user:pw@fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
  });

  it('only opens same-origin paths', () => {
    expect(safePath('/dashboard/freelancer/wallet')).toBe('/dashboard/freelancer/wallet');
    expect(safePath('https://evil.dz')).toBe('/');
    expect(safePath('//evil.dz')).toBe('/');
    expect(safePath('/\\evil.dz')).toBe('/');
    expect(safePath(null)).toBe('/');
  });
});

describe('sending', () => {
  it('sends to every device of the owner, and only theirs', async () => {
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: FCM, ...keys }, 'fr');
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: APPLE, ...keys }, 'fr');
    await savePushSubscription({ type: 'USER', id: 'u-2' }, { endpoint: `${FCM}2`, ...keys }, 'fr');
    await pushToUser('u-1', { title: 'Paiement reçu', body: '45 000 DA', url: '/dashboard/freelancer/wallet' });
    expect(wp.send).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(wp.send.mock.calls[0]![1] as string);
    expect(payload).toEqual({ title: 'Paiement reçu', body: '45 000 DA', url: '/dashboard/freelancer/wallet' });
  });

  it('moves a re-subscribed device to its new owner', async () => {
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: FCM, ...keys }, 'fr');
    await savePushSubscription({ type: 'USER', id: 'u-2' }, { endpoint: FCM, ...keys }, 'fr');
    await pushToUser('u-1', { title: 't', body: 'b' });
    expect(wp.send).not.toHaveBeenCalled();
    expect((await db.read()).pushSubscriptions).toHaveLength(1);
  });

  it('deletes devices the push service says are gone, drops repeat failures', async () => {
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: FCM, ...keys }, 'fr');
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: APPLE, ...keys }, 'fr');
    wp.send.mockImplementation(async (sub: { endpoint: string }) => {
      throw Object.assign(new Error('x'), { statusCode: sub.endpoint === FCM ? 410 : 500 });
    });
    for (let i = 0; i < 5; i++) await pushToUser('u-1', { title: 't', body: 'b' });
    expect((await db.read()).pushSubscriptions).toEqual([]);
  });

  it('keeps consultants and members apart', async () => {
    await savePushSubscription({ type: 'MENTOR', id: 'u-1' }, { endpoint: FCM, ...keys }, 'fr');
    await pushToUser('u-1', { title: 't', body: 'b' });
    expect(wp.send).not.toHaveBeenCalled();
    await pushToMentor('u-1', { title: 't', body: 'b' });
    expect(wp.send).toHaveBeenCalledTimes(1);
  });

  it('pushes every in-app notification', async () => {
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: FCM, ...keys }, 'fr');
    await createNotification({ userId: 'u-1', type: 'GENERAL', title: 'Nouveau message', body: 'Salut', href: '/dashboard/freelancer/messages' });
    expect((await db.read()).notifications).toHaveLength(1);
    expect(JSON.parse(wp.send.mock.calls[0]![1] as string).url).toBe('/dashboard/freelancer/messages');
  });

  it('never throws into the caller', async () => {
    await savePushSubscription({ type: 'USER', id: 'u-1' }, { endpoint: FCM, ...keys }, 'fr');
    wp.send.mockRejectedValue(new Error('network down'));
    await expect(createNotification({ userId: 'u-1', type: 'GENERAL', title: 't', body: 'b' })).resolves.toBeUndefined();
  });
});

describe('routes', () => {
  it('saves the caller’s device and refuses unknown push services', async () => {
    expect((await POST(req('POST', { endpoint: FCM, keys, locale: 'ar' }))).status).toBe(200);
    expect((await db.read()).pushSubscriptions?.[0]).toMatchObject({ ownerType: 'USER', ownerId: 'u-1', locale: 'ar' });
    expect((await POST(req('POST', { endpoint: 'https://internal.metwork.dz/hook', keys }))).status).toBe(422);
  });

  it('only removes the caller’s own device', async () => {
    await savePushSubscription({ type: 'USER', id: 'u-2' }, { endpoint: FCM, ...keys }, 'fr');
    expect((await DELETE(req('DELETE', { endpoint: FCM }))).status).toBe(204);
    expect((await db.read()).pushSubscriptions).toHaveLength(1);
  });

  it('needs a session; consultants subscribe as MENTOR', async () => {
    actor = null;
    expect((await POST(req('POST', { endpoint: FCM, keys }))).status).toBe(403);
    expect((await MENTOR_POST(req('POST', { endpoint: FCM, keys }))).status).toBe(401);
    consultant = 'm-1';
    expect((await MENTOR_POST(req('POST', { endpoint: FCM, keys }))).status).toBe(200);
    expect((await db.read()).pushSubscriptions?.[0]).toMatchObject({ ownerType: 'MENTOR', ownerId: 'm-1' });
  });
});
