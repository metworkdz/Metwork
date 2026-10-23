/**
 * GET  /api/orders — the caller's orders (as founder or freelancer).
 * POST /api/orders — `{ source: 'GIG', gigId, lang }` or
 *      `{ source: 'DEVIS', conversationId, invoiceId }`: a founder orders.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { getTranslations } from 'next-intl/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { db } from '@/server/db/store';
import { acceptDevis, orderGig, ordersFor } from '@/server/orders/service';
import { orderErrorResponse } from '@/server/orders/http';
import { withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('GIG'), gigId: z.string().min(1).max(80), lang: z.enum(['fr', 'en', 'ar']).default('fr') }).strict(),
  z.object({ source: z.literal('DEVIS'), conversationId: z.string().uuid(), invoiceId: z.string().min(1).max(80) }).strict(),
]);

export async function GET() {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  return json({ orders: ordersFor(await db.read(), guard.user.id) });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`order-create:${guard.user.id}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many orders. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withMessaging(async () => {
    let r;
    if (input.source === 'GIG') {
      const t = await getTranslations({ locale: input.lang, namespace: 'orders' });
      r = await orderGig(guard.user.id, input.gigId, t('newOrderMessage'));
    } else {
      r = await acceptDevis(guard.user.id, input.conversationId, input.invoiceId);
    }
    return r.ok ? json({ id: r.value.id }, { status: 201 }) : orderErrorResponse(r.reason);
  });
}
