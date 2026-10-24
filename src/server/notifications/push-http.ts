/**
 * Shared body handling for the two subscription routes (members and
 * consultants): validate the browser's PushSubscription JSON and save or
 * remove it for the given owner.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { isPushConfigured, removePushSubscription, savePushSubscription, type PushOwner } from '@/server/notifications/push';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }).passthrough(),
  locale: z.enum(['fr', 'en', 'ar']).default('fr'),
}).passthrough();

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) }).passthrough();

async function readJson(req: NextRequest): Promise<unknown> {
  try { return await req.json(); } catch { return undefined; }
}

export async function handleSubscribe(req: NextRequest, owner: PushOwner) {
  if (!isPushConfigured()) return jsonError(503, 'PUSH_DISABLED', 'Push notifications are not configured');
  if (!(await checkRateLimitDistributed(`push:${owner.type}:${owner.id}`, 20, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute.');
  }
  const body = await readJson(req);
  if (body === undefined) return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  try {
    const input = subscribeSchema.parse(body);
    const ok = await savePushSubscription(owner, { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }, input.locale);
    if (!ok) return jsonError(422, 'UNSUPPORTED_ENDPOINT', 'This browser push service is not supported');
    return json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
}

export async function handleUnsubscribe(req: NextRequest, owner: PushOwner) {
  const body = await readJson(req);
  if (body === undefined) return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  try {
    await removePushSubscription(owner, unsubscribeSchema.parse(body).endpoint);
    return noContent();
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
}
