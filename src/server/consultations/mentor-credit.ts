/**
 * Consultant earnings credit for a settled consultation.
 *
 * Extracted from ./instant-book so that BOTH settlement paths — the wallet path
 * (instant-book.ts) and the direct card-charge path (direct-payment.ts) — can
 * call one implementation without importing each other. There is exactly one
 * way a consultant gets paid, and this is it.
 *
 * Deliberately currency- and provider-blind: it reads integer DZD off the
 * booking and knows nothing about CIB, Stripe, EUR or exchange rates. If a
 * provider check ever appears in this file, the single-canonical-module rule
 * has been broken.
 */
import type { MentorBookingRecord } from '@/server/db/store';
import { creditPendingEarning } from '@/server/mentors/ledger';

/**
 * Credit the consultant's PENDING balance for a settled consultation and record
 * the platform's share / discount subsidy. Non-blocking: the booking is already
 * settled, so a ledger error must never roll it back — it is logged and
 * reconcilable later (the credit is idempotent per booking).
 *
 * Owner-locked split (2026-06-18): the consultant is paid on the FULL base price
 * (`consultantShareBase`), the platform absorbs every discount — so a fully
 * promo'd (gross 0) PAID booking still pays the consultant, with the platform
 * subsidising it. FREE_QUOTA (monthly free credit) sessions never pay the
 * consultant. A free mentor (no base) is a no-op.
 */
export async function creditMentorForSettledBooking(
  booking: Pick<
    MentorBookingRecord,
    | 'id'
    | 'mentorId'
    | 'chargeType'
    | 'amountCharged'
    | 'guestAmountDue'
    | 'consultantShareBase'
    | 'tierDiscountAmount'
    | 'promoDiscountAmount'
    | 'appliedPromoCode'
  >,
): Promise<void> {
  // Free monthly-credit sessions never credit the consultant.
  if (booking.chargeType === 'FREE_QUOTA') return;
  const collected = booking.amountCharged ?? booking.guestAmountDue ?? 0;
  const base = booking.consultantShareBase ?? collected;
  // Nothing to pay when there is no base (free mentor).
  if (!base || base <= 0) return;
  try {
    await creditPendingEarning({
      mentorId: booking.mentorId,
      bookingId: booking.id,
      grossAmount: collected,
      consultantShareBase: booking.consultantShareBase ?? null,
      tierDiscountAmount: booking.tierDiscountAmount ?? null,
      promoDiscountAmount: booking.promoDiscountAmount ?? null,
      appliedPromoCode: booking.appliedPromoCode ?? null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[consultations] mentor credit failed for booking ${booking.id} (settled OK, reconcilable):`,
      err instanceof Error ? err.message : err,
    );
  }
}
