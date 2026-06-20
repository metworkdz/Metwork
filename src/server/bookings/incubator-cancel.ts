/**
 * Incubator cancellation of an UNPAID booking.
 *
 * An incubator may cancel one of their bookings while it is still awaiting
 * payment (PENDING_PAYMENT) — a card-deposit intent or a cash reserve that has
 * never collected a dinar. This path moves NO money: nothing was ever charged,
 * so there is nothing to refund or claw back.
 *
 * Once a booking is paid/settled (PENDING wallet escrow, CONFIRMED, COMPLETED)
 * it is rejected here with ALREADY_PAID — those follow the EXISTING refund flow
 * (PATCH /api/incubator/bookings/[id]), never this one.
 *
 * Idempotent: a replay finds the booking already CANCELLED and returns
 * ALREADY_FINAL, so a double-click can't do anything twice.
 */
import { db, type BookingRecord } from '@/server/db/store';
import { isAwaitingPayment } from './status';

export type CancelUnpaidResult =
  | { ok: true; booking: BookingRecord; client: { name: string; email: string | null } }
  | { ok: false; reason: 'NO_INCUBATOR' | 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_PAID' | 'ALREADY_FINAL' };

export async function cancelUnpaidBooking(args: {
  bookingId: string;
  /** The incubator manager's user id (from the authenticated session). */
  managerId: string;
}): Promise<CancelUnpaidResult> {
  return db.update<CancelUnpaidResult>((d) => {
    const incubator = d.incubators.find((i) => i.managerId === args.managerId);
    if (!incubator) return { ok: false, reason: 'NO_INCUBATOR' };

    const booking = d.bookings.find((b) => b.id === args.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };

    // Ownership: the booked item must belong to this incubator.
    const owns =
      (booking.itemKind === 'SPACE' &&
        (d.spaces ?? []).some((s) => s.id === booking.itemId && s.incubatorId === incubator.id)) ||
      (booking.itemKind === 'PROGRAM' &&
        (d.programs ?? []).some((p) => p.id === booking.itemId && p.incubatorId === incubator.id)) ||
      (booking.itemKind === 'EVENT' &&
        (d.events ?? []).some((e) => e.id === booking.itemId && e.incubatorId === incubator.id));
    if (!owns) return { ok: false, reason: 'FORBIDDEN' };

    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
      return { ok: false, reason: 'ALREADY_FINAL' };
    }
    // Only unpaid (awaiting-payment) bookings cancel through this path.
    if (!isAwaitingPayment(booking)) {
      return { ok: false, reason: 'ALREADY_PAID' };
    }

    // Unpaid → no money ever moved. Void the intent only.
    const now = new Date().toISOString();
    booking.status = 'CANCELLED';
    booking.declineReason = 'CANCELLED_BY_PROVIDER_UNPAID';
    booking.updatedAt = now;

    const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
    return {
      ok: true,
      booking: { ...booking },
      client: {
        name: user?.fullName ?? booking.clientName ?? 'Client',
        email: user?.email ?? booking.clientEmail ?? null,
      },
    };
  });
}
