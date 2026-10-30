/**
 * GET  /api/admin/refunds — the refund queue.
 * POST /api/admin/refunds — an admin opens a refund for any paid item
 *                           (optionally accepting it straight away).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { acceptRefund, listRefundRows, requestRefund } from '@/server/refunds/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  return json({ refunds: await listRefundRows() });
}

const schema = z.object({
  sourceKind: z.enum(['BOOKING', 'MENTOR_BOOKING']),
  sourceId: z.string().min(1).max(100),
  reason: z.string().trim().min(3).max(1000),
  acceptNow: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let input;
  try { input = schema.parse(await req.json()); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  const created = await requestRefund({
    sourceKind: input.sourceKind, sourceId: input.sourceId, reason: input.reason,
    requestedBy: 'ADMIN', requestedById: guard.user.id,
  });
  if (!created.ok) {
    if (created.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Payment not found');
    if (created.reason === 'ALREADY_REFUNDED') return jsonError(409, 'ALREADY_REFUNDED', 'This payment was already refunded');
    return jsonError(422, created.reason, 'Nothing online was paid for this item');
  }
  if (!input.acceptNow) return json({ refund: created.request }, { status: 201 });

  const accepted = await acceptRefund({ id: created.request.id, adminId: guard.user.id });
  if (!accepted.ok) return jsonError(409, accepted.reason, 'The request was opened but could not be accepted', { id: created.request.id });
  return json({ refund: accepted.request }, { status: 201 });
}
