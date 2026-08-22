/**
 * Shared core for "mark the cash leg of a CASH_DEPOSIT card booking as
 * collected", reused by both booking-owner surfaces:
 *   - incubator: SPACE / PROGRAM / EVENT bookings
 *   - consultant: PROGRAM bookings only (mentor-owned)
 *
 * Each caller resolves its own ownership rule (which listing ids it owns) and
 * passes it in as `isOwned` — the money/lifecycle logic (idempotent PAID
 * transition, customer resolution) lives here exactly once so the two routes
 * can never drift apart on it.
 *
 * IMPORTANT — money model:
 *   • NO wallet/ledger movement happens here. The cash balance is settled
 *     OFF-PLATFORM (hand-to-hand). The platform's cut on the online portion
 *     was already taken in full at card settlement (card-payment.ts). Marking
 *     cash paid is a pure audit/lifecycle transition.
 *   • Transition: paymentStatus AWAITING_CASH → PAID, stamping cashCollectedAt
 *     and cashCollectedBy. Idempotent — a booking already PAID returns as-is.
 */
import { db, type BookingRecord } from '@/server/db/store';

export interface MarkCashPaidBooking extends BookingRecord {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export type MarkCashPaidResult =
  | { ok: true; booking: MarkCashPaidBooking }
  | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_CASH_DEPOSIT' | 'NOT_CONFIRMED' | 'NOT_AWAITING_CASH' };

export async function markCashPaid(input: {
  bookingId: string;
  /** Resolved by the caller from its own ownership rule (incubator vs. mentor). */
  isOwned: (booking: BookingRecord) => boolean;
  /** Actor id stamped onto `cashCollectedBy` (audit only, not FK-enforced). */
  collectedByActorId: string;
}): Promise<MarkCashPaidResult> {
  return db.update<MarkCashPaidResult>((d) => {
    const booking = d.bookings.find((b) => b.id === input.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };
    if (!input.isOwned(booking)) return { ok: false, reason: 'FORBIDDEN' };

    // Only card CASH_DEPOSIT bookings have a cash leg to collect.
    if (booking.paymentMethod !== 'card' || booking.paymentMode !== 'CASH_DEPOSIT') {
      return { ok: false, reason: 'NOT_CASH_DEPOSIT' };
    }
    // A reversed/cancelled booking has no balance to collect.
    if (booking.status !== 'CONFIRMED') return { ok: false, reason: 'NOT_CONFIRMED' };

    const withCustomer = (): MarkCashPaidBooking => {
      const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
      return {
        ...booking,
        customerName: user?.fullName ?? booking.clientName ?? 'Unknown',
        customerEmail: user?.email ?? booking.clientEmail ?? '',
        customerPhone: user?.phone ?? booking.clientPhone ?? '',
      };
    };

    // Idempotent: already collected → return unchanged.
    if (booking.paymentStatus === 'PAID') return { ok: true, booking: withCustomer() };
    if (booking.paymentStatus !== 'AWAITING_CASH') return { ok: false, reason: 'NOT_AWAITING_CASH' };

    const now = new Date().toISOString();
    booking.paymentStatus = 'PAID';
    booking.cashCollectedAt = now;
    booking.cashCollectedBy = input.collectedByActorId;
    booking.updatedAt = now;

    return { ok: true, booking: withCustomer() };
  });
}
