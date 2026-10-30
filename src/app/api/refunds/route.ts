/**
 * POST /api/refunds — a signed-in client (or an admin) asks for a refund.
 *
 * Opens a REQUESTED refund; an admin decides. A client can only ask about their
 * OWN payment, and a stranger probing someone else's booking id gets the same
 * 404 as an id that does not exist.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { requestRefund } from '@/server/refunds/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  sourceKind: z.enum(['BOOKING', 'MENTOR_BOOKING']),
  sourceId: z.string().min(1).max(100),
  reason: z.string().trim().min(3).max(1000),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let input;
  try { input = schema.parse(await req.json()); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  const isAdmin = guard.user.role === 'ADMIN';
  if (!isAdmin) {
    const d = await db.read();
    const owner = input.sourceKind === 'BOOKING'
      ? d.bookings.find((b) => b.id === input.sourceId)?.userId
      : (d.mentorBookings ?? []).find((b) => b.id === input.sourceId)?.userId;
    if (!owner || owner !== guard.user.id) return jsonError(404, 'NOT_FOUND', 'Payment not found');
  }

  const result = await requestRefund({
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    reason: input.reason,
    requestedBy: isAdmin ? 'ADMIN' : 'CLIENT',
    requestedById: guard.user.id,
  });
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Payment not found');
    if (result.reason === 'ALREADY_REFUNDED') return jsonError(409, 'ALREADY_REFUNDED', 'This payment was already refunded');
    if (result.reason === 'TOO_LATE') return jsonError(422, 'TOO_LATE', 'Consultations can only be refunded up to 24 hours before the session');
    return jsonError(422, result.reason, 'Nothing online was paid for this item, so there is nothing to refund');
  }
  return json({ refund: { id: result.request.id, status: result.request.status, amount: result.request.amount }, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
}
