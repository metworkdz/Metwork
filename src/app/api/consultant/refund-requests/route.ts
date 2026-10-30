/**
 * POST /api/consultant/refund-requests — a consultant PROPOSES a refund for a
 * participant of one of THEIR OWN programs. It only opens a request flagged as
 * coming from the owner; an admin always decides, so a consultant can never
 * refund (and so claw back) a sale on their own.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { fromZod, json, jsonError } from '@/server/http/json';
import { requestRefund } from '@/server/refunds/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  bookingId: z.string().min(1).max(100),
  reason: z.string().trim().min(3).max(1000),
});

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let input;
  try { input = schema.parse(await req.json()); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  const d = await db.read();
  const booking = d.bookings.find((b) => b.id === input.bookingId);
  const owned = booking?.itemKind === 'PROGRAM'
    && (d.programs ?? []).some((p) => p.id === booking.itemId && p.mentorId === guard.mentorId);
  if (!owned) return jsonError(404, 'NOT_FOUND', 'Booking not found');

  const result = await requestRefund({
    sourceKind: 'BOOKING', sourceId: input.bookingId, reason: input.reason,
    requestedBy: 'OWNER', requestedById: guard.mentorId,
  });
  if (!result.ok) {
    if (result.reason === 'ALREADY_REFUNDED') return jsonError(409, 'ALREADY_REFUNDED', 'This payment was already refunded');
    return jsonError(422, result.reason, 'Nothing online was paid for this booking');
  }
  return json({ refund: { id: result.request.id, status: result.request.status } }, { status: result.replayed ? 200 : 201 });
}
