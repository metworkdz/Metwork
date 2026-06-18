/**
 * POST /api/consultant/bookings/:id/cancel  { reason? }
 *
 * The consultant cancels a settled, not-yet-completed consultation. For a
 * REGISTERED member the full amount is refunded to their Metwork wallet and the
 * consultant's held earning is reversed. PAID GUEST bookings are not cancellable
 * here (no internal wallet) — admin handles those. Ownership-enforced, idempotent.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { cancelByConsultant } from '@/server/consultations/cancel';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  // Body is optional (reason only) — tolerate an empty body.
  let input: z.infer<typeof schema> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) input = schema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  // Ownership: the booking must belong to the signed-in consultant.
  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find((b) => b.id === id);
  if (!booking || booking.mentorId !== guard.mentorId) {
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }

  const result = await cancelByConsultant({ bookingId: id, reason: input.reason ?? null });
  if (!result.ok) {
    switch (result.reason) {
      case 'GUEST_UNSUPPORTED':
        return jsonError(409, 'GUEST_UNSUPPORTED', 'Guest bookings must be cancelled by an admin (no internal wallet to refund).');
      case 'WALLET_FROZEN':
        return jsonError(409, 'WALLET_FROZEN', 'The client\'s wallet is frozen — the refund cannot be issued. Contact support.');
      case 'WRONG_STATE':
        return jsonError(409, 'WRONG_STATE', 'This booking cannot be cancelled in its current state.');
      default:
        return jsonError(404, 'NOT_FOUND', 'Booking not found');
    }
  }

  return json({
    id: result.booking.id,
    status: result.booking.status,
    refundedAmount: result.refundedAmount,
    replayed: result.replayed,
  });
}
