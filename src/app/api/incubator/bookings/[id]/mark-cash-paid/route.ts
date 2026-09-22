/**
 * PATCH /api/incubator/bookings/[id]/mark-cash-paid
 *
 * Closes the cash leg of a CASH_DEPOSIT card booking. The client paid the
 * deposit (D) online by card at booking time; the remaining balance (T − D)
 * is collected in cash on-site by the incubator. This endpoint records that
 * collection.
 *
 * Core logic lives in `@/server/bookings/mark-cash-paid` — shared with the
 * consultant equivalent (`/api/consultant/bookings/[id]/mark-cash-paid`) so
 * the money/lifecycle transition can never drift between the two surfaces.
 * This route only resolves INCUBATOR ownership (SPACE/PROGRAM/EVENT).
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { createNotification } from '@/server/notifications/create-notification';
import { dispatchReceiptIfDue } from '@/server/bookings/card-payment';
import { markCashPaid } from '@/server/bookings/mark-cash-paid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === guard.user.id);
  if (!incubator) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile');

  const ownedSpaceIds = new Set(
    (data.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );
  const ownedEventIds = new Set(
    (data.events ?? []).filter((e) => e.incubatorId === incubator.id).map((e) => e.id),
  );

  const result = await markCashPaid({
    bookingId: id,
    isOwned: (booking) =>
      (booking.itemKind === 'SPACE'   && ownedSpaceIds.has(booking.itemId))   ||
      (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId)) ||
      (booking.itemKind === 'EVENT'   && ownedEventIds.has(booking.itemId)),
    collectedByActorId: guard.user.id,
  });

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Booking not found');
    if (result.reason === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your booking');
    if (result.reason === 'NOT_CASH_DEPOSIT') return jsonError(409, 'NOT_CASH_DEPOSIT', 'Booking has no cash balance to collect');
    if (result.reason === 'NOT_CONFIRMED') return jsonError(409, 'NOT_CONFIRMED', 'Booking is not confirmed');
    return jsonError(409, 'NOT_AWAITING_CASH', 'Booking is not awaiting cash');
  }

  // AWAITED, not fire-and-forget. This generates a PDF and sends an email;
  // left floating, the serverless function can freeze the moment the response
  // is returned and the receipt is never sent — which is precisely how cash
  // clients ended up with nothing. It never throws (it catches internally),
  // so awaiting cannot fail the request. Idempotent via finalReceiptSentAt.
  await dispatchReceiptIfDue(result.booking.id);

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
