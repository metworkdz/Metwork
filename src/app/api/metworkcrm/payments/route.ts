/**
 * GET  /api/metworkcrm/payments — list with filters (status, direction, overdue, q)
 * POST /api/metworkcrm/payments — create
 *
 * ADMIN-only (product spec §4.14: TEAM_MEMBER gets 403 on the route AND the
 * API — `requireCrmApiAdmin`, not `requireCrmApiUser`, is the whole point of
 * this file).
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiAdmin } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { paymentInputSchema, paymentListQuerySchema } from '@/server/metworkcrm/validation/payments';
import { createPayment, listPayments } from '@/server/metworkcrm/services/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = paymentListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listPayments(parsed.data);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiAdmin();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = paymentInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const payment = await createPayment(parsed.data, guard.user.id);
    return json(payment, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
