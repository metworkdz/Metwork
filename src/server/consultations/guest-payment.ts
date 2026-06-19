/**
 * Guest consultation payment — token resolution, lazy provider init, and
 * SERVER-VERIFIED idempotent settlement.
 *
 * Threat model & guarantees:
 *  - The amount is whatever was computed server-side at approval and frozen on
 *    the booking as `guestAmountDue`. The client never supplies a price.
 *  - Payment is only ever confirmed by asking the provider directly
 *    (getSlickPayTransferStatus) or by a synchronous provider result — never
 *    by trusting the browser redirect.
 *  - Settlement is idempotent: the PAID/CONFIRMED transition is claimed inside
 *    a single store mutation, so replays (page refresh, double return) are
 *    no-ops. Promo consumption and confirmation emails fire only on the
 *    claiming transition.
 *  - The pay token is a single-use, 7-day random UUID. Once a booking is PAID,
 *    init refuses and the token can no longer trigger a charge.
 */
import { db, type MentorBookingRecord, type MentorRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { getActiveProvider } from '@/server/payments/registry';
import { getSlickPayTransferStatus } from '@/server/payments/slickpay-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import { consumePromoCode } from '@/server/promo-codes/service';
import { sendGuestConfirmationOnce } from '@/server/notifications/guest-confirm';
import { creditMentorForSettledBooking } from './instant-book';
import { releaseSlot } from '@/server/mentors/slot-lock';
import { resolveSettledStatus } from './lifecycle';
import { sendConsultationReadyOnce } from '@/server/notifications/consultation-ready';
import { sendBookingNotificationOnce } from '@/server/notifications/booking-notification';

export type GuestPayState =
  | 'INVALID'
  | 'EXPIRED'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  | 'REJECTED';

export interface GuestPayView {
  state: GuestPayState;
  booking?: MentorBookingRecord;
  mentor?: MentorRecord;
  amount?: number;
}

function findGuestBookingByToken(
  bookings: MentorBookingRecord[] | undefined,
  token: string,
): MentorBookingRecord | undefined {
  return (bookings ?? []).find(
    (b) => b.source === 'guest' && typeof b.payToken === 'string' && b.payToken === token,
  );
}

function isExpired(booking: MentorBookingRecord): boolean {
  return (
    typeof booking.payTokenExpiresAt === 'string' &&
    new Date(booking.payTokenExpiresAt).getTime() < Date.now()
  );
}

function isSettled(booking: MentorBookingRecord): boolean {
  return booking.paymentStatus === 'PAID' || booking.status === 'CONFIRMED';
}

/**
 * Read-only view for the pay page. Does NOT call the provider or settle.
 */
export async function getGuestPayView(token: string): Promise<GuestPayView> {
  const data = await db.read();
  const booking = findGuestBookingByToken(data.mentorBookings, token);
  if (!booking) return { state: 'INVALID' };

  const mentor = (await findMentorById(booking.mentorId)) ?? undefined;

  if (isSettled(booking)) return { state: 'CONFIRMED', booking, mentor, amount: booking.guestAmountDue ?? 0 };
  if (booking.status === 'REJECTED') return { state: 'REJECTED', booking, mentor };
  if (isExpired(booking)) return { state: 'EXPIRED', booking, mentor };
  return { state: 'AWAITING_PAYMENT', booking, mentor, amount: booking.guestAmountDue ?? 0 };
}

/**
 * Idempotent settlement. Claims the PAID/CONFIRMED transition atomically; only
 * the claiming caller consumes the promo and triggers the confirmation emails.
 * Safe to call any number of times.
 */
async function markPaidAndConfirm(
  bookingId: string,
  providerRef: string | null,
): Promise<boolean> {
  // Instant-book bookings settle into the lifecycle state (READY / AWAITING_LINK)
  // resolved from the consultant's meeting defaults; legacy admin-approval guest
  // bookings simply become CONFIRMED. Resolve outside the lock (needs the mentor).
  const snapshot = await db.read();
  const snap = (snapshot.mentorBookings ?? []).find((b) => b.id === bookingId);
  const settled =
    snap?.instantBook === true
      ? resolveSettledStatus((await findMentorById(snap.mentorId)) ?? {})
      : null;

  const claim = await db.update<{ booking: MentorBookingRecord; claimed: boolean } | null>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return null;
    if (isSettled(booking)) return { booking, claimed: false };
    booking.paymentStatus = 'PAID';
    if (settled) {
      booking.status          = settled.status;
      booking.meetingMode     = settled.meetingMode;
      booking.meetingLink     = settled.meetingLink;
      booking.meetingAddress  = settled.meetingAddress;
      booking.meetingMapsLink = settled.meetingMapsLink;
    } else {
      booking.status       = 'CONFIRMED';
    }
    if (providerRef) booking.paymentProviderRef = providerRef;
    booking.updatedAt = new Date().toISOString();
    return { booking, claimed: true };
  });
  if (!claim) return false;

  if (claim.claimed) {
    // Consume the promo NOW (never at approval) so unpaid links don't burn it.
    if (claim.booking.appliedPromoCode) {
      await consumePromoCode(claim.booking.appliedPromoCode);
    }
    // Credit the consultant's PENDING balance — ONLY for instant-book (pay-first)
    // bookings. Legacy admin-approval guest bookings lack `instantBook` and must
    // never credit the ledger. The helper applies the promo-split (consultant
    // paid on the full base, platform absorbs the discount), is non-blocking +
    // idempotent: a ledger error can't roll back the already-settled booking.
    if (claim.booking.instantBook === true) {
      await creditMentorForSettledBooking(claim.booking);
    }
    // Settled booking now occupies the slot — drop any transient payment hold.
    await releaseSlot(claim.booking.id);
    // Instant-book bookings that settled into READY: notify the client the
    // session is ready (deduped via linkSentAt). AWAITING_LINK waits for a link.
    if (settled && claim.booking.status === 'READY') {
      void sendConsultationReadyOnce(claim.booking.id);
    }
    // Notify the consultant of the new booking — once (instant-book only).
    if (claim.booking.instantBook === true) {
      void sendBookingNotificationOnce(claim.booking.id);
    }
    // Both-party confirmation emails + PDF receipt — sent exactly once.
    await sendGuestConfirmationOnce(claim.booking.id);
  }
  return true;
}

/**
 * Verify with the provider and settle if paid. Called when the guest returns
 * from the hosted checkout. Never trusts the redirect — asks the provider.
 */
export async function verifyAndSettleGuestPayment(token: string): Promise<GuestPayView> {
  const data = await db.read();
  const booking = findGuestBookingByToken(data.mentorBookings, token);
  if (!booking) return { state: 'INVALID' };

  const mentor = (await findMentorById(booking.mentorId)) ?? undefined;

  if (isSettled(booking)) {
    return { state: 'CONFIRMED', booking, mentor, amount: booking.guestAmountDue ?? 0 };
  }
  if (booking.status === 'REJECTED') return { state: 'REJECTED', booking, mentor };

  // No provider reference yet → the guest never started checkout.
  if (!booking.paymentProviderRef) {
    if (isExpired(booking)) return { state: 'EXPIRED', booking, mentor };
    return { state: 'AWAITING_PAYMENT', booking, mentor, amount: booking.guestAmountDue ?? 0 };
  }

  // Ask the provider directly. If the provider isn't configured (mock/dev),
  // treat as not-yet-paid rather than crashing the page.
  let status: { completed: 0 | 1 };
  try {
    status = await getSlickPayTransferStatus(booking.paymentProviderRef);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return { state: 'AWAITING_PAYMENT', booking, mentor, amount: booking.guestAmountDue ?? 0 };
    }
    throw err;
  }

  if (status.completed !== 1) {
    // Not paid. Expiry only matters once we know there's no settled payment.
    if (isExpired(booking)) return { state: 'EXPIRED', booking, mentor };
    return { state: 'AWAITING_PAYMENT', booking, mentor, amount: booking.guestAmountDue ?? 0 };
  }

  await markPaidAndConfirm(booking.id, booking.paymentProviderRef);
  const after = (await db.read()).mentorBookings?.find((b) => b.id === booking.id);
  return { state: 'CONFIRMED', booking: after ?? booking, mentor, amount: booking.guestAmountDue ?? 0 };
}

/**
 * Settle a guest consultation from a SIGNATURE-VERIFIED provider webhook. Unlike
 * the return-page path it does not re-poll the provider — the webhook is already
 * authenticated. `bookingId` is the provider `external_id` we set at init
 * (= booking.id). Idempotent (delegates to markPaidAndConfirm); safe to replay.
 */
export async function settleGuestConsultationFromWebhook(
  bookingId: string,
  providerRef: string | null,
  status: 'COMPLETED' | 'FAILED',
): Promise<'SETTLED' | 'ALREADY' | 'NOT_FOUND' | 'IGNORED'> {
  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find(
    (b) => b.id === bookingId && b.source === 'guest',
  );
  if (!booking) return 'NOT_FOUND';
  if (status !== 'COMPLETED') return 'IGNORED';
  if (isSettled(booking)) return 'ALREADY';
  const ok = await markPaidAndConfirm(booking.id, providerRef);
  return ok ? 'SETTLED' : 'NOT_FOUND';
}

export type InitGuestPaymentResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; reason: GuestPayState | 'PROVIDER_FAILED'; message?: string };

/**
 * Create the hosted-checkout transfer lazily (only when the guest clicks Pay).
 * Returns the URL to send the browser to. A synchronous provider (mock sync)
 * settles immediately and returns the pay page itself, which will then render
 * the confirmed state.
 */
export async function initGuestPayment(
  token: string,
  appBaseUrl: string,
): Promise<InitGuestPaymentResult> {
  const data = await db.read();
  const booking = findGuestBookingByToken(data.mentorBookings, token);
  if (!booking) return { ok: false, reason: 'INVALID' };
  if (isSettled(booking)) return { ok: false, reason: 'CONFIRMED' };
  if (booking.status === 'REJECTED') return { ok: false, reason: 'REJECTED' };
  if (isExpired(booking)) return { ok: false, reason: 'EXPIRED' };

  const amount = booking.guestAmountDue ?? 0;
  if (amount <= 0) {
    // Should have been auto-confirmed at approval; settle defensively.
    await markPaidAndConfirm(booking.id, null);
    return { ok: false, reason: 'CONFIRMED' };
  }

  const base = appBaseUrl.replace(/\/$/, '');
  const localeSeg = booking.guestLocale ?? 'fr';
  const returnUrl = `${base}/${localeSeg}/consultation/pay/${token}`;

  const provider = getActiveProvider();
  let result;
  try {
    result = await provider.initTopUp({
      topUpId:   booking.id,
      userId:    `guest:${booking.id}`,
      amount,
      returnUrl,
      webhookUrl: `${base}/api/webhooks/payments/${provider.code}`,
      customer: {
        fullName: booking.userName,
        email:    booking.userEmail,
        phone:    booking.userPhone,
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'PROVIDER_FAILED',
      message: err instanceof Error ? err.message : 'Payment provider error',
    };
  }

  // Record the provider reference so the return verification can poll it.
  await db.update((d) => {
    const b = (d.mentorBookings ?? []).find((x) => x.id === booking.id);
    if (b) {
      b.paymentProviderRef = result.providerRef;
      b.updatedAt = new Date().toISOString();
    }
  });

  // Synchronous settlement (mock sync) → confirm now, bounce back to pay page.
  if (result.status === 'COMPLETED') {
    await markPaidAndConfirm(booking.id, result.providerRef);
    return { ok: true, redirectUrl: returnUrl };
  }

  if (result.status === 'FAILED' || !result.redirectUrl) {
    return { ok: false, reason: 'PROVIDER_FAILED', message: 'Could not start the payment session' };
  }

  return { ok: true, redirectUrl: result.redirectUrl };
}

/**
 * Reconcile guest consultations that were paid online but never settled (payer
 * closed the tab after paying; no webhook). Re-verifies each via the provider
 * (poll) and settles idempotently. Only touches bookings idle ≥ `olderThanMs`.
 */
export async function reconcilePendingGuestConsultations(
  opts: { olderThanMs?: number; limit?: number } = {},
): Promise<{ checked: number; settled: number }> {
  const olderThanMs = opts.olderThanMs ?? 5 * 60_000;
  const limit = opts.limit ?? 200;
  const cutoff = Date.now() - olderThanMs;
  const data = await db.read();
  const candidates = (data.mentorBookings ?? [])
    .filter(
      (b) =>
        b.source === 'guest' &&
        !isSettled(b) &&
        b.status !== 'REJECTED' &&
        !!b.paymentProviderRef &&
        typeof b.payToken === 'string' &&
        Date.parse(b.updatedAt) <= cutoff,
    )
    .slice(0, limit);

  let settled = 0;
  for (const b of candidates) {
    const view = await verifyAndSettleGuestPayment(b.payToken!);
    if (view.state === 'CONFIRMED') settled += 1;
  }
  return { checked: candidates.length, settled };
}
