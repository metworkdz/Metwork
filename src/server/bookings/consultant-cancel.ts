/**
 * Consultant cancellation of their own space reservation.
 *
 * A consultant reservation is always a CASH hold: nothing was ever charged on
 * Metwork (see the mentor branch in `createSpaceBooking`), so cancelling moves
 * NO money — there is nothing to refund or claw back. That is why a consultant
 * may cancel at any time, unlike the paid flows which go through the refund
 * path in PATCH /api/incubator/bookings/[id].
 *
 * Releasing the desk holds is the part that matters: a COWORKING /
 * PRIVATE_OFFICE reservation writes per-day DeskBookingRecords, and leaving
 * them active would keep the unit unbookable for everyone else long after the
 * parent reservation is gone.
 *
 * Idempotent: a replay finds the reservation already CANCELLED and reports
 * ALREADY_FINAL, so a double-tap can never double-apply.
 */
import { db, type BookingRecord } from '@/server/db/store';

export type ConsultantCancelResult =
  | { ok: true; booking: BookingRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_FINAL' };

export async function cancelConsultantSpaceBooking(args: {
  bookingId: string;
  /** From the consultant session — never from the request body. */
  mentorId: string;
}): Promise<ConsultantCancelResult> {
  return db.update<ConsultantCancelResult>((d) => {
    const booking = (d.bookings ?? []).find((b) => b.id === args.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };

    // Ownership is the reservation's own mentorId — a consultant can only ever
    // cancel a reservation they made themselves.
    if (booking.itemKind !== 'SPACE' || booking.mentorId !== args.mentorId) {
      return { ok: false, reason: 'FORBIDDEN' };
    }

    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
      return { ok: false, reason: 'ALREADY_FINAL' };
    }

    // Defensive: consultant reservations are cash-only by construction. If a
    // row ever carried a settled payment method, refuse rather than silently
    // void something that moved money.
    if (booking.paymentMethod !== 'manual') return { ok: false, reason: 'FORBIDDEN' };

    const now = new Date().toISOString();
    booking.status = 'CANCELLED';
    booking.declineReason = 'CANCELLED_BY_CONSULTANT';
    booking.updatedAt = now;

    // Free every desk/office day this reservation held, so the availability
    // calendar reopens the unit immediately.
    for (const desk of d.deskBookings ?? []) {
      if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') {
        desk.status = 'CANCELLED';
      }
    }

    return { ok: true, booking: { ...booking } };
  });
}
