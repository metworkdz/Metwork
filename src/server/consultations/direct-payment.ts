/**
 * DIRECT consultation payment — the payer is charged the full amount on a
 * hosted checkout, with no wallet involved.
 *
 * ONE settler for every direct-charge consultation, regardless of:
 *  - who booked it   — a registered member or a legacy guest record, and
 *  - which card rail — CIB/Edahabia (SlickPay, DZD) or Visa/Mastercard
 *    (Stripe, billed in EUR at a frozen rate).
 *
 * The provider is a lookup, never a branch in the money logic: the amount, the
 * promo split, the consultant credit, the notifications and the receipt are
 * identical in every case and denominated in DZD. The only provider-aware code
 * here is `initDirectPayment` (which checkout to open) and `pollProviderStatus`
 * (which API to ask). Bookings paid from the wallet are settled elsewhere, by
 * `settleMemberTopUp` in ./instant-book — `isDirectCharge` keeps the two apart.
 *
 * Threat model & guarantees:
 *  - The amount is whatever was computed server-side at booking creation and
 *    frozen on the record. The client never supplies a price.
 *  - Payment is only ever confirmed by asking the provider directly, or by a
 *    signature-verified webhook — never by trusting the browser redirect.
 *  - Settlement is idempotent: the PAID transition is claimed inside a single
 *    store mutation, so replays (page refresh, double return, webhook racing
 *    the poll) are no-ops. Promo consumption, the consultant credit and the
 *    confirmation emails fire only on the claiming transition.
 *  - The pay token is a single-use, 7-day random UUID. Once a booking is PAID,
 *    init refuses and the token can no longer trigger a charge.
 */
import { db, type MentorBookingRecord, type MentorRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { getActiveProvider, getProviderByCode } from '@/server/payments/registry';
import { getSlickPayTransferStatus } from '@/server/payments/slickpay-provider';
import { getStripeSessionStatus } from '@/server/payments/stripe-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import { consumePromoCode } from '@/server/promo-codes/service';
import { sendGuestConfirmationOnce } from '@/server/notifications/guest-confirm';
import { creditMentorForSettledBooking } from './mentor-credit';
import { releaseSlot } from '@/server/mentors/slot-lock';
import { resolveSettledStatusWithZoom, type ResolvedSettledStatusWithZoom } from './lifecycle';
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

/** How a consultation is being paid. */
export type ConsultationPaymentProvider = 'SLICKPAY' | 'STRIPE' | 'WALLET';

/**
 * Resolve which rail owns a booking's settlement.
 *
 * Legacy records predate `paymentProvider`, so they are mapped by origin — the
 * behaviour they actually had: a guest record was always a direct SlickPay
 * charge, a registered record was always wallet-first. Getting this mapping
 * wrong would hand a booking to the wrong settler, so it stays explicit.
 */
export function resolveBookingPaymentProvider(
  booking: Pick<MentorBookingRecord, 'paymentProvider' | 'source'>,
): ConsultationPaymentProvider {
  if (booking.paymentProvider === 'STRIPE') return 'STRIPE';
  if (booking.paymentProvider === 'SLICKPAY') return 'SLICKPAY';
  if (booking.paymentProvider === 'WALLET') return 'WALLET';
  return booking.source === 'guest' ? 'SLICKPAY' : 'WALLET';
}

/** True when this booking settles through THIS module (not the wallet path). */
export function isDirectCharge(
  booking: Pick<MentorBookingRecord, 'paymentProvider' | 'source'>,
): boolean {
  return resolveBookingPaymentProvider(booking) !== 'WALLET';
}

/**
 * Ask the booking's own provider whether the charge completed. Never infer from
 * the redirect. Throws ProviderNotConfiguredError when the rail is unavailable
 * (mock/dev, or missing keys) so callers can degrade to "not yet paid".
 */
async function pollProviderStatus(
  booking: MentorBookingRecord,
): Promise<{ completed: 0 | 1 }> {
  const ref = booking.paymentProviderRef;
  if (!ref) return { completed: 0 };
  return resolveBookingPaymentProvider(booking) === 'STRIPE'
    ? getStripeSessionStatus(ref)
    : getSlickPayTransferStatus(ref);
}

function findBookingByToken(
  bookings: MentorBookingRecord[] | undefined,
  token: string,
): MentorBookingRecord | undefined {
  // Keyed on the token alone (unguessable, single-use) so registered and guest
  // bookings resolve identically — but only direct-charge bookings belong to
  // this module; a wallet booking's token is settled by settleMemberTopUp.
  return (bookings ?? []).find(
    (b) => typeof b.payToken === 'string' && b.payToken === token && isDirectCharge(b),
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

/** Amount frozen on the booking at creation. Never recomputed, never client-supplied. */
function amountDue(booking: MentorBookingRecord): number {
  return booking.guestAmountDue ?? booking.amountCharged ?? 0;
}

/**
 * Read-only view for the pay / return page. Does NOT call the provider or settle.
 */
export async function getDirectPayView(token: string): Promise<GuestPayView> {
  const data = await db.read();
  const booking = findBookingByToken(data.mentorBookings, token);
  if (!booking) return { state: 'INVALID' };

  const mentor = (await findMentorById(booking.mentorId)) ?? undefined;

  if (isSettled(booking)) return { state: 'CONFIRMED', booking, mentor, amount: amountDue(booking) };
  if (booking.status === 'REJECTED') return { state: 'REJECTED', booking, mentor };
  if (isExpired(booking)) return { state: 'EXPIRED', booking, mentor };
  return { state: 'AWAITING_PAYMENT', booking, mentor, amount: amountDue(booking) };
}

/**
 * Idempotent settlement. Claims the PAID transition atomically; only the
 * claiming caller consumes the promo, credits the consultant and triggers the
 * emails. Safe to call any number of times.
 */
async function markPaidAndConfirm(
  bookingId: string,
  providerRef: string | null,
): Promise<boolean> {
  // Instant-book bookings settle into the lifecycle state (READY / AWAITING_LINK)
  // resolved from the consultant's meeting defaults; legacy admin-approval guest
  // bookings simply become CONFIRMED. Resolve outside the lock (needs the mentor
  // / a Zoom API round-trip).
  //
  // Guard on `!isSettled(snap)` BEFORE resolving — this function is called
  // from both the return-page poll and the webhook, which can race or simply
  // be invoked repeatedly (page reload). Without this guard every repeat call
  // would create a new orphaned Zoom meeting even though the booking never
  // changes after the first one claims it.
  const snapshot = await db.read();
  const snap = (snapshot.mentorBookings ?? []).find((b) => b.id === bookingId);
  let settled: ResolvedSettledStatusWithZoom | null = null;
  if (snap && snap.instantBook === true && !isSettled(snap)) {
    const mentor = await findMentorById(snap.mentorId);
    settled = mentor
      ? await resolveSettledStatusWithZoom({
          mentor,
          topic: `Metwork consultation — ${mentor.fullName}`,
          startTimeIso: snap.consultationDate && snap.consultationTime
            ? `${snap.consultationDate}T${snap.consultationTime}:00`
            : null,
          durationMinutes: snap.durationMinutes ?? 60,
          existingZoomMeetingId: snap.zoomMeetingId,
        })
      : { status: 'AWAITING_LINK', meetingMode: null, meetingLink: null, meetingAddress: null, meetingMapsLink: null, meetingSource: null, zoomJoinUrl: null, zoomStartUrl: null, zoomMeetingId: null };
  }

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
      booking.meetingSource   = settled.meetingSource;
      booking.zoomJoinUrl     = settled.zoomJoinUrl;
      booking.zoomStartUrl    = settled.zoomStartUrl;
      booking.zoomMeetingId   = settled.zoomMeetingId;
    } else {
      booking.status       = 'CONFIRMED';
    }
    if (providerRef) booking.paymentProviderRef = providerRef;
    booking.updatedAt = new Date().toISOString();
    return { booking, claimed: true };
  });
  if (!claim) return false;

  if (claim.claimed) {
    // Consume the promo NOW (never at booking creation) so unpaid links don't burn it.
    if (claim.booking.appliedPromoCode) {
      await consumePromoCode(claim.booking.appliedPromoCode);
    }
    // Credit the consultant's PENDING balance — ONLY for instant-book (pay-first)
    // bookings. Legacy admin-approval guest bookings lack `instantBook` and must
    // never credit the ledger. The helper applies the promo-split (consultant
    // paid on the full base, platform absorbs the discount), is non-blocking +
    // idempotent: a ledger error can't roll back the already-settled booking.
    //
    // Reads `amountCharged`/`consultantShareBase` — integer DZD — with no
    // knowledge of which card rail was used. A Stripe-paid consultation credits
    // exactly like a CIB one.
    if (claim.booking.instantBook === true) {
      await creditMentorForSettledBooking(claim.booking);
    }
    // Settled booking now occupies the slot — drop any transient payment hold.
    await releaseSlot(claim.booking.id);
    // Instant-book bookings that settled into READY: notify the client the
    // session is ready (deduped via linkSentAt). AWAITING_LINK waits for a link.
    // AWAITED — unawaited sends are killed when the serverless response returns.
    if (settled && claim.booking.status === 'READY') {
      await sendConsultationReadyOnce(claim.booking.id);
    }
    // Notify the consultant of the new booking — once (instant-book only).
    if (claim.booking.instantBook === true) {
      await sendBookingNotificationOnce(claim.booking.id);
    }
    // Both-party confirmation emails + PDF receipt — sent exactly once.
    await sendGuestConfirmationOnce(claim.booking.id);
  }
  return true;
}

/**
 * Verify with the provider and settle if paid. Called when the payer returns
 * from the hosted checkout. Never trusts the redirect — asks the provider.
 */
export async function verifyAndSettleDirectPayment(token: string): Promise<GuestPayView> {
  const data = await db.read();
  const booking = findBookingByToken(data.mentorBookings, token);
  if (!booking) return { state: 'INVALID' };

  const mentor = (await findMentorById(booking.mentorId)) ?? undefined;

  if (isSettled(booking)) {
    return { state: 'CONFIRMED', booking, mentor, amount: amountDue(booking) };
  }
  if (booking.status === 'REJECTED') return { state: 'REJECTED', booking, mentor };

  // No provider reference yet → the payer never started checkout.
  if (!booking.paymentProviderRef) {
    if (isExpired(booking)) return { state: 'EXPIRED', booking, mentor };
    return { state: 'AWAITING_PAYMENT', booking, mentor, amount: amountDue(booking) };
  }

  // Ask the provider directly. If the provider isn't configured (mock/dev),
  // treat as not-yet-paid rather than crashing the page.
  let status: { completed: 0 | 1 };
  try {
    status = await pollProviderStatus(booking);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return { state: 'AWAITING_PAYMENT', booking, mentor, amount: amountDue(booking) };
    }
    throw err;
  }

  if (status.completed !== 1) {
    // Not paid. Expiry only matters once we know there's no settled payment.
    if (isExpired(booking)) return { state: 'EXPIRED', booking, mentor };
    return { state: 'AWAITING_PAYMENT', booking, mentor, amount: amountDue(booking) };
  }

  await markPaidAndConfirm(booking.id, booking.paymentProviderRef);
  const after = (await db.read()).mentorBookings?.find((b) => b.id === booking.id);
  return { state: 'CONFIRMED', booking: after ?? booking, mentor, amount: amountDue(booking) };
}

/**
 * Settle a consultation from a SIGNATURE-VERIFIED provider webhook. Unlike the
 * return-page path it does not re-poll the provider — the webhook is already
 * authenticated. `bookingId` is the provider `external_id` we set at init
 * (= booking.id). Idempotent (delegates to markPaidAndConfirm); safe to replay,
 * which is what makes duplicate webhook delivery a no-op rather than a
 * double-credit. Provider-agnostic: SlickPay and Stripe both land here.
 */
export async function settleConsultationFromWebhook(
  bookingId: string,
  providerRef: string | null,
  status: 'COMPLETED' | 'FAILED',
): Promise<'SETTLED' | 'ALREADY' | 'NOT_FOUND' | 'IGNORED'> {
  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find(
    (b) => b.id === bookingId && isDirectCharge(b),
  );
  if (!booking) return 'NOT_FOUND';
  if (status !== 'COMPLETED') return 'IGNORED';
  if (isSettled(booking)) return 'ALREADY';
  const ok = await markPaidAndConfirm(booking.id, providerRef);
  return ok ? 'SETTLED' : 'NOT_FOUND';
}

export type InitDirectPaymentResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; reason: GuestPayState | 'PROVIDER_FAILED'; message?: string };

/**
 * Create the hosted-checkout transfer lazily (only when the payer clicks Pay).
 * Returns the URL to send the browser to. A synchronous provider (mock sync)
 * settles immediately and returns the pay page itself, which will then render
 * the confirmed state.
 *
 * Used by the legacy guest pay page. Registered members get their checkout URL
 * up front from `createInstantBooking`, which calls `startDirectCheckout`.
 */
export async function initDirectPayment(
  token: string,
  appBaseUrl: string,
): Promise<InitDirectPaymentResult> {
  const data = await db.read();
  const booking = findBookingByToken(data.mentorBookings, token);
  if (!booking) return { ok: false, reason: 'INVALID' };
  if (isSettled(booking)) return { ok: false, reason: 'CONFIRMED' };
  if (booking.status === 'REJECTED') return { ok: false, reason: 'REJECTED' };
  if (isExpired(booking)) return { ok: false, reason: 'EXPIRED' };

  const amount = amountDue(booking);
  if (amount <= 0) {
    // Should have been auto-confirmed at creation; settle defensively.
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
      userId:    booking.userId ?? `guest:${booking.id}`,
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

export type StartDirectCheckoutResult =
  | {
      ok: true;
      settled: false;
      redirectUrl: string;
      /** EUR actually billed (Stripe only) — for display/audit, never for money math. */
      amountForeign: number | null;
    }
  /** Synchronous provider (mock sync) already settled the booking. */
  | { ok: true; settled: true }
  | { ok: false; message: string };

export interface StartDirectCheckoutInput {
  booking: MentorBookingRecord;
  /** 'SLICKPAY' (DZD) or 'STRIPE' (EUR at the frozen rate). */
  provider: 'SLICKPAY' | 'STRIPE';
  /** Integer DZD — the canonical, server-computed amount. */
  amountDzd: number;
  /** Frozen EUR/DZD rate. Required for STRIPE, ignored otherwise. */
  exchangeRate?: number | null;
  /** Absolute app base URL. */
  appBaseUrl: string;
  locale: string;
  /** Line-item label on the hosted checkout. */
  description?: string;
}

/**
 * Open a hosted checkout for a freshly-created direct-charge booking and stamp
 * the provider reference on it. Called by `createInstantBooking`; kept here so
 * init and settlement stay in one module.
 *
 * The booking's own id is the provider `external_id`, which is what lets the
 * shared webhook dispatcher route the callback back to this module.
 */
export async function startDirectCheckout(
  input: StartDirectCheckoutInput,
): Promise<StartDirectCheckoutResult> {
  const { booking } = input;
  const base = input.appBaseUrl.replace(/\/$/, '');
  const returnUrl = `${base}/${input.locale}/consultation/instant/${booking.payToken}`;

  // Stripe is selected per-transaction, so resolve it by code rather than
  // through getActiveProvider() (which is the env-wide default, e.g. SlickPay).
  const provider =
    input.provider === 'STRIPE' ? getProviderByCode('stripe') : getActiveProvider();
  if (!provider) return { ok: false, message: 'Payment provider unavailable' };

  let result;
  try {
    result = await provider.initTopUp({
      topUpId: booking.id,
      userId: booking.userId ?? `guest:${booking.id}`,
      amount: input.amountDzd,
      returnUrl,
      webhookUrl:
        input.provider === 'STRIPE'
          ? `${base}/api/webhooks/stripe`
          : `${base}/api/webhooks/payments/${provider.code}`,
      customer: {
        fullName: booking.userName,
        email: booking.userEmail,
        phone: booking.userPhone,
      },
      description: input.description,
      locale: input.locale,
      fx: input.exchangeRate != null ? { rate: input.exchangeRate } : undefined,
    });
  } catch (err) {
    // Log the provider's own words for debugging, but never hand them to the
    // client — they can carry key fragments, account ids and internal state.
    // eslint-disable-next-line no-console
    console.error(
      `[consultations] ${input.provider} checkout failed for booking ${booking.id}:`,
      err instanceof Error ? err.message : err,
    );
    return { ok: false, message: 'Could not start the payment session' };
  }

  // Persist the provider reference + the FX audit pair before redirecting, so
  // the return poll and the webhook can both resolve the charge.
  await db.update((d) => {
    const b = (d.mentorBookings ?? []).find((x) => x.id === booking.id);
    if (!b) return;
    b.paymentProviderRef = result.providerRef;
    if (result.foreign) {
      b.stripeAmountEur = result.foreign.amount;
      b.stripeRateApplied = result.foreign.rate;
    }
    b.updatedAt = new Date().toISOString();
  });

  if (result.status === 'COMPLETED') {
    await markPaidAndConfirm(booking.id, result.providerRef);
    return { ok: true, settled: true };
  }
  if (result.status === 'FAILED' || !result.redirectUrl) {
    return { ok: false, message: 'Could not start the payment session' };
  }
  return {
    ok: true,
    settled: false,
    redirectUrl: result.redirectUrl,
    amountForeign: result.foreign?.amount ?? null,
  };
}

/**
 * Reconcile consultations that were paid online but never settled (payer closed
 * the tab after paying; no webhook). Re-verifies each via the provider (poll)
 * and settles idempotently. Only touches bookings idle ≥ `olderThanMs`.
 *
 * Covers BOTH registered and guest direct-charge bookings — a registered
 * card payer abandoning the return page is exactly as likely as a guest one.
 */
export async function reconcilePendingDirectConsultations(
  opts: { olderThanMs?: number; limit?: number } = {},
): Promise<{ checked: number; settled: number }> {
  const olderThanMs = opts.olderThanMs ?? 5 * 60_000;
  const limit = opts.limit ?? 200;
  const cutoff = Date.now() - olderThanMs;
  const data = await db.read();
  const candidates = (data.mentorBookings ?? [])
    .filter(
      (b) =>
        isDirectCharge(b) &&
        !isSettled(b) &&
        b.status !== 'REJECTED' &&
        !!b.paymentProviderRef &&
        typeof b.payToken === 'string' &&
        Date.parse(b.updatedAt) <= cutoff,
    )
    .slice(0, limit);

  let settled = 0;
  for (const b of candidates) {
    const view = await verifyAndSettleDirectPayment(b.payToken!);
    if (view.state === 'CONFIRMED') settled += 1;
  }
  return { checked: candidates.length, settled };
}
