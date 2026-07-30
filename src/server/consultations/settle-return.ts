/**
 * Post-checkout return resolution for instant-book consultations.
 *
 * ONE entry point for "the payer just came back — what happened?", shared by
 * the return page (server render) and its polling API route so the two can
 * never disagree. It dispatches on the rail frozen at booking creation:
 *
 *   WALLET   → settleMemberTopUp   (top-up settled? then debit + confirm)
 *   SLICKPAY → verifyAndSettleDirectPayment (ask the provider, then settle)
 *   / STRIPE
 *
 * Every underlying settler is idempotent and provider-verified, so this is safe
 * to call on every render and on every poll. The redirect is never evidence of
 * payment — it only tells us to go and check.
 */
import { db, type MentorBookingRecord, type MentorRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { settleMemberTopUp } from './instant-book';
import {
  isDirectCharge,
  verifyAndSettleDirectPayment,
  type GuestPayState,
} from './direct-payment';

export type InstantReturnState = GuestPayState;

export interface InstantReturnView {
  state: InstantReturnState;
  booking?: MentorBookingRecord;
  mentor?: MentorRecord;
  /** Integer DZD. The only amount ever surfaced — never EUR, never the rate. */
  amount?: number;
}

/**
 * Verify and settle a booking from its pay token, whichever rail it used.
 * Returns the state to render. Unknown tokens collapse to INVALID rather than
 * leaking whether a token exists.
 */
export async function verifyAndSettleByToken(token: string): Promise<InstantReturnView> {
  if (!token || token.length < 8) return { state: 'INVALID' };

  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find((b) => b.payToken === token);
  if (!booking) return { state: 'INVALID' };

  // Direct card charge (CIB/Edahabia or Visa/Mastercard) — already returns a
  // fully-populated view.
  if (isDirectCharge(booking)) {
    return verifyAndSettleDirectPayment(token);
  }

  // Wallet path: settleMemberTopUp answers with the state only, so enrich it
  // with the same shape the direct path returns.
  const result = await settleMemberTopUp(token);
  const settledBooking = result.booking ?? booking;
  const mentor = (await findMentorById(settledBooking.mentorId)) ?? undefined;
  const amount = settledBooking.amountCharged ?? settledBooking.guestAmountDue ?? 0;

  if (result.state === 'INVALID') return { state: 'INVALID' };
  if (result.state === 'EXPIRED') return { state: 'EXPIRED', booking: settledBooking, mentor };
  return { state: result.state, booking: settledBooking, mentor, amount };
}
