/**
 * PATCH /api/incubator/bookings/[id]/mark-cash-paid
 *
 * Closes the cash leg of a CASH_DEPOSIT card booking. The client paid the
 * deposit (D) online by card at booking time; the remaining balance (T − D)
 * is collected in cash on-site by the incubator. This endpoint records that
 * collection.
 *
 * IMPORTANT — money model:
 *   • NO wallet movement happens here. The cash balance is settled OFF-PLATFORM
 *     (hand-to-hand). The platform commission was already taken in full at card
 *     settlement (card-payment.ts: +D PAYOUT, −C COMMISSION on the incubator
 *     wallet). Marking cash paid is a pure audit/lifecycle transition.
 *   • Transition: paymentStatus AWAITING_CASH → PAID, stamping cashCollectedAt
 *     and cashCollectedBy. Idempotent — a booking already PAID returns as-is.
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { createNotification } from '@/server/notifications/create-notification';
import { dispatchCardReceiptIfDue } from '@/server/bookings/card-payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const incubator = d.incubators.find((i) => i.managerId === guard.user.id);
    if (!incubator) return 'NO_INCUBATOR';

    const ownedSpaceIds = new Set(
      (d.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      (d.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );
    const ownedEventIds = new Set(
      (d.events ?? []).filter((e) => e.incubatorId === incubator.id).map((e) => e.id),
    );

    const booking = d.bookings.find((b) => b.id === id);
    if (!booking) return 'NOT_FOUND';

    const isOwned =
      (booking.itemKind === 'SPACE'   && ownedSpaceIds.has(booking.itemId))   ||
      (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId)) ||
      (booking.itemKind === 'EVENT'   && ownedEventIds.has(booking.itemId));
    if (!isOwned) return 'FORBIDDEN';

    // Only card CASH_DEPOSIT bookings have a cash leg to collect.
    if (booking.paymentMethod !== 'card' || booking.paymentMode !== 'CASH_DEPOSIT') {
      return 'NOT_CASH_DEPOSIT';
    }
    // A reversed/cancelled booking has no balance to collect.
    if (booking.status !== 'CONFIRMED') return 'NOT_CONFIRMED';

    const withCustomer = () => {
      const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
      return {
        ...booking,
        customerName: user?.fullName ?? booking.clientName ?? 'Unknown',
        customerEmail: user?.email ?? booking.clientEmail ?? '',
        customerPhone: user?.phone ?? booking.clientPhone ?? '',
      };
    };

    // Idempotent: already collected → return unchanged.
    if (booking.paymentStatus === 'PAID') return withCustomer();
    if (booking.paymentStatus !== 'AWAITING_CASH') return 'NOT_AWAITING_CASH';

    const now = new Date().toISOString();
    booking.paymentStatus = 'PAID';
    booking.cashCollectedAt = now;
    booking.cashCollectedBy = guard.user.id;
    booking.updatedAt = now;

    return withCustomer();
  });

  if (result === 'NO_INCUBATOR') return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile');
  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Booking not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your booking');
  if (result === 'NOT_CASH_DEPOSIT') return jsonError(409, 'NOT_CASH_DEPOSIT', 'Booking has no cash balance to collect');
  if (result === 'NOT_CONFIRMED') return jsonError(409, 'NOT_CONFIRMED', 'Booking is not confirmed');
  if (result === 'NOT_AWAITING_CASH') return jsonError(409, 'NOT_AWAITING_CASH', 'Booking is not awaiting cash');

  // Fire-and-forget: issue the final (paid-in-full) receipt now that the cash
  // balance is in. Idempotent via finalReceiptSentAt — safe on repeat calls.
  void dispatchCardReceiptIfDue(result.id);

  // Fire-and-forget: let a registered client know their balance was received.
  void (async () => {
    if (result.userId) {
      await createNotification({
        userId: result.userId,
        type: 'BOOKING_CONFIRMED',
        title: 'Balance received',
        body: `The remaining balance for "${result.itemName}" has been marked as paid.`,
        href: '/dashboard/entrepreneur/bookings',
      });
    }
  })();

  return json({ booking: result });
}
