/**
 * GET  /api/orders/[id] — one order, as the caller sees it.
 * POST /api/orders/[id] — `{ action }`:
 *   PAY_WALLET (founder: pay the part due from the wallet),
 *   DELIVER    (freelancer: mark delivered, requests the balance),
 *   CANCEL     (either side, before the deposit is paid).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { db } from '@/server/db/store';
import { cancelOrder, markDelivered, orderView, payOrderFromWallet } from '@/server/orders/service';
import { orderErrorResponse } from '@/server/orders/http';
import { withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

const schema = z.object({ action: z.enum(['PAY_WALLET', 'DELIVER', 'CANCEL']) }).strict();

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const data = await db.read();
  const o = (data.serviceOrders ?? []).find((x) => x.id === id);
  const view = o ? orderView(data, o, guard.user.id) : null;
  return view ? json(view) : jsonError(404, 'NOT_FOUND', 'Order not found');
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!(await checkRateLimitDistributed(`order-action:${guard.user.id}`, 20, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  return withMessaging(async () => {
    const r =
      input.action === 'PAY_WALLET'
        ? guard.user.role === 'ENTREPRENEUR' ? await payOrderFromWallet(guard.user.id, id) : ({ ok: false, reason: 'NOT_FOUND' } as const)
        : input.action === 'DELIVER'
          ? guard.user.role === 'FREELANCER' ? await markDelivered(guard.user.id, id) : ({ ok: false, reason: 'NOT_FOUND' } as const)
          : await cancelOrder(guard.user.id, id);
    if (!r.ok) return orderErrorResponse(r.reason);
    return json(orderView(await db.read(), r.value, guard.user.id));
  });
}
