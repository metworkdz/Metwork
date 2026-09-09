/**
 * PATCH /api/consultant/program-bookings/[id]/mark-cash-paid
 *
 * Closes the cash leg of a CASH_DEPOSIT card booking on one of THIS
 * consultant's own programs. Owner-side (attendee bookings on the
 * consultant's programs) — NOT the same resource as
 * `/api/consultant/space-bookings` (the consultant AS A BUYER of a space) or
 * `/api/consultant/bookings` (the consultant's own 1:1 consultations).
 *
 * Core logic lives in `@/server/bookings/mark-cash-paid` — shared with the
 * incubator equivalent (`/api/incubator/bookings/[id]/mark-cash-paid`) so the
 * money/lifecycle transition can never drift between the two surfaces. This
 * route only resolves MENTOR ownership (PROGRAM bookings on this consultant's
 * own programs).
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { json, jsonError } from '@/server/http/json';
import { createNotification } from '@/server/notifications/create-notification';
import { dispatchCardReceiptIfDue } from '@/server/bookings/card-payment';
import { markCashPaid } from '@/server/bookings/mark-cash-paid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const data = await db.read();
  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.mentorId === guard.mentorId).map((p) => p.id),
  );

  const result = await markCashPaid({
    bookingId: id,
    isOwned: (booking) => booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId),
    collectedByActorId: guard.mentorId,
  });

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Booking not found');
    if (result.reason === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your booking');
    if (result.reason === 'NOT_CASH_DEPOSIT') return jsonError(409, 'NOT_CASH_DEPOSIT', 'Booking has no cash balance to collect');
    if (result.reason === 'NOT_CONFIRMED') return jsonError(409, 'NOT_CONFIRMED', 'Booking is not confirmed');
    return jsonError(409, 'NOT_AWAITING_CASH', 'Booking is not awaiting cash');
  }

  // The client paid the balance, so the FINAL receipt is now due — the same
  // dispatch the incubator route uses. It used to be skipped here because the
  // dispatcher could only address an incubator; it now resolves a consultant
  // letterhead too, so a consultant's client gets the same paperwork.
  void dispatchCardReceiptIfDue(result.booking.id);

  // Fire-and-forget: let a registered client know their balance was received.
  void (async () => {
    if (result.booking.userId) {
      await createNotification({
        userId: result.booking.userId,
        type: 'BOOKING_CONFIRMED',
        title: 'Balance received',
        body: `The remaining balance for "${result.booking.itemName}" has been marked as paid.`,
        href: '/dashboard/entrepreneur/bookings',
      });
    }
  })();

  return json({ booking: result.booking });
}
