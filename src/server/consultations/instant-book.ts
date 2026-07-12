/**
 * Instant-book, pay-first consultations (feature-flagged).
 *
 * Replaces the legacy admin-approval gate: a consultation is paid up front and
 * confirmed immediately, with NO admin review. Per the locked product decision:
 *
 *   • Member, wallet funded   → debit wallet now → CONFIRMED (one mutation).
 *   • Member, short on funds   → PENDING_PAYMENT + SlickPay top-up of the
 *                                shortfall; on return the wallet is debited and
 *                                the booking settled (settleMemberTopUp).
 *   • Guest                    → PENDING_PAYMENT + payToken; settled by the
 *                                EXISTING guest-payment.ts / pay route (SlickPay
 *                                direct), which already handle pay-first bookings.
 *   • Zero amount (free intro / free monthly credit / full promo) → CONFIRMED now.
 *
 * Guarantees mirror the rest of the money layer: server-authoritative pricing
 * (never trust the client), single-mutation atomic debit+booking, idempotent
 * settlement claims keyed by clientReference, and provider-verified top-ups.
 *
 * NOTE: this whole module is gated behind CONSULTATION_INSTANT_BOOK and is unused
 * in production until P7 flips the flag. The consultant earnings credit is wired
 * in at the marked settlement points by P4 (see `// P4:` markers).
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type MentorBookingRecord,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { isMentorApproved } from '@/lib/mentor-approval';
import { computeConsultationCharge, type ConsultationChargeBreakdown } from './pricing';
import { computeHourlySlots, mentorBookingHoldsSeat } from '@/server/mentors/availability';
import { lockSlot, releaseSlot } from '@/server/mentors/slot-lock';
import { getTopUp, initiateTopUp } from '@/server/wallet/service';
import { consumePromoCode } from '@/server/promo-codes/service';
import { creditPendingEarning } from '@/server/mentors/ledger';
import { resolveSettledStatus } from './lifecycle';
import { sendConsultationReadyOnce } from '@/server/notifications/consultation-ready';
import { sendBookingNotificationOnce } from '@/server/notifications/booking-notification';
import { sendConsultationReceivedOnce } from '@/server/notifications/consultation-received';

/** Pay tokens live for 7 days — long enough to finish a hosted checkout. */
const PAY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wallet top-up floor (mirrors the wallet service). */
const MIN_TOPUP = 100;

/**
 * Instant-book is now the only consultation flow (the legacy admin-approval
 * path was retired in P7b). Retained as an always-true shim so the existing
 * call-sites/guards keep compiling; it no longer reads any env flag.
 */
export function isInstantBookEnabled(): boolean {
  return true;
}

export interface InstantBookActor {
  /** Registered member id. */
  id: string;
  /** Membership-tier consultation discount fraction (0–1). 0 if none. */
  membershipDiscountFraction?: number;
}

export interface CreateInstantBookingInput {
  mentorId: string;
  /** Registered member, or null/undefined for a guest. */
  actor?: InstantBookActor | null;
  name: string;
  email: string;
  phone: string;
  message: string;
  durationMinutes: number;
  consultationDate?: string | null;
  consultationTime?: string | null;
  scheduledAt?: string | null;
  /** Pre-validated promo (resolved by the route). */
  appliedPromoCode?: string | null;
  promoDiscountPercent?: number | null;
  locale?: 'en' | 'fr' | 'ar';
  /** Idempotency key — replays return the original booking. */
  clientReference: string;
  /** Absolute app base URL for building the top-up return URL. */
  appBaseUrl: string;
}

export type CreateInstantBookingResult =
  | { ok: true; mode: 'confirmed'; booking: MentorBookingRecord; replayed: boolean }
  | {
      ok: true;
      mode: 'awaiting_payment';
      booking: MentorBookingRecord;
      payToken: string;
      /** Present for the member top-up path (SlickPay hosted checkout URL). */
      redirectUrl?: string | null;
      amount: number;
    }
  | {
      ok: false;
      reason: 'MENTOR_NOT_FOUND' | 'WALLET_FROZEN' | 'PROVIDER_FAILED' | 'SLOT_NOT_BOOKABLE';
      message?: string;
    };

/* ───────────────────────────── Internal helpers ───────────────────────────── */

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

function ensureArrays(d: StoreDraft): void {
  if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];
  if (!Array.isArray(d.mentorConsultations)) d.mentorConsultations = [];
  if (!Array.isArray(d.transactions)) d.transactions = [];
  if (!Array.isArray(d.wallets)) d.wallets = [];
}

function ensureWallet(d: StoreDraft, userId: string, now: string): WalletRecord {
  let wallet = d.wallets.find((w) => w.userId === userId);
  if (!wallet) {
    wallet = { id: randomUUID(), userId, balance: 0, currency: 'DZD', status: 'ACTIVE', createdAt: now, updatedAt: now };
    d.wallets.push(wallet);
  }
  return wallet;
}

/** Base fields shared by every instant booking record. */
function baseBooking(
  input: CreateInstantBookingInput,
  now: string,
  extra: Partial<MentorBookingRecord>,
  charge?: ConsultationChargeBreakdown,
  id?: string,
): MentorBookingRecord {
  const isGuest = !input.actor;
  // No-stacking: the promo is only persisted (and later consumed) when it
  // actually won against the membership-tier discount. When the tier discount
  // won — or no discount applied — the entered promo is discarded so it isn't
  // consumed for a booking it never reduced.
  const promoWon = charge?.appliedSource === 'promo';
  return {
    id: id ?? randomUUID(),
    mentorId: input.mentorId,
    userId: input.actor?.id ?? null,
    userName: input.name,
    userEmail: input.email,
    userPhone: input.phone,
    message: input.message,
    consultationDate: input.consultationDate ?? null,
    consultationTime: input.consultationTime ?? null,
    durationMinutes: input.durationMinutes,
    scheduledAt: input.scheduledAt ?? null,
    status: 'PENDING_PAYMENT',
    adminNote: null,
    appliedPromoCode: promoWon ? (input.appliedPromoCode ?? null) : null,
    promoDiscountPercent: promoWon ? (input.promoDiscountPercent ?? null) : null,
    chargeType: 'PAID',
    freeQuotaMonth: null,
    transactionId: null,
    refundTransactionId: null,
    clientReference: input.clientReference,
    source: isGuest ? 'guest' : 'registered',
    guestLocale: input.locale ?? 'fr',
    instantBook: true,
    // Frozen promo-split breakdown (P3): the consultant is paid on the full
    // base price, the platform absorbs every discount. Persisted so settlement
    // and the admin P&L read one source of truth.
    consultantShareBase: charge?.basePrice ?? null,
    tierDiscountAmount: charge?.tierDiscountAmount ?? null,
    promoDiscountAmount: charge?.promoDiscountAmount ?? null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/**
 * Credit the consultant's PENDING balance for a settled consultation and record
 * the platform's share / discount subsidy. Non-blocking: the booking is already
 * CONFIRMED, so a ledger error must never roll it back — it is logged and
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
      `[instant-book] mentor credit failed for booking ${booking.id} (settled OK, reconcilable):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/* ───────────────────────────── Create ───────────────────────────── */

export async function createInstantBooking(
  input: CreateInstantBookingInput,
): Promise<CreateInstantBookingResult> {
  const mentor = await findMentorById(input.mentorId);
  // Non-APPROVED consultants (pending/rejected self-signups) are not bookable —
  // collapse to NOT_FOUND, exactly like the public profile route. This gates
  // NEW bookings only; settlement paths for existing bookings are untouched.
  if (!mentor || !isMentorApproved(mentor)) return { ok: false, reason: 'MENTOR_NOT_FOUND' };

  const isGuest = !input.actor;
  const charge = computeConsultationCharge({
    feePerHour: mentor.consultationFee ?? 0,
    durationMinutes: input.durationMinutes,
    membershipDiscountFraction: isGuest ? 0 : input.actor?.membershipDiscountFraction,
    promoDiscountPercent: input.promoDiscountPercent ?? 0,
  });
  const { gross } = charge;

  const now = new Date().toISOString();
  const bookingId = randomUUID();
  const payToken = randomUUID();
  const payTokenExpiresAt = new Date(Date.now() + PAY_TOKEN_TTL_MS).toISOString();
  // Post-settlement lifecycle state (READY vs AWAITING_LINK) from the
  // consultant's meeting defaults. `paymentStatus: 'PAID'` remains the settled
  // marker, so the status value is free to be READY / AWAITING_LINK.
  const settled = resolveSettledStatus(mentor);

  // ── Slot validation + concurrency lock ─────────────────────────────────────
  // When a concrete slot was chosen, gate it through the shared bookable-slots
  // validator (single source of truth) and take an atomic hold so two concurrent
  // payers can't claim the same time. Skipped for a REPLAY (same clientReference)
  // — re-validating would trip over the caller's own already-occupying booking
  // and break retry-safety. The lock is keyed to this booking id and released on
  // settlement / provider failure (and self-expires after its TTL).
  let slotLocked = false;
  if (input.consultationDate && input.consultationTime) {
    // Hour-alignment is a hard rule — a start is always on the hour (09:00,
    // 10:00, …), never :30/:45, regardless of duration. Reject anything else
    // before touching the store.
    if (!/^\d{2}:00$/.test(input.consultationTime)) {
      return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };
    }
    const snap = await db.read();
    const replay = (snap.mentorBookings ?? []).find((b) =>
      isGuest
        ? b.source === 'guest' && b.clientReference === input.clientReference
        : b.userId === input.actor!.id && b.clientReference === input.clientReference,
    );
    if (!replay) {
      const mentorBookings = (snap.mentorBookings ?? []).filter((b) => b.mentorId === mentor.id);
      const hasPublishedAgenda = (mentor.weeklyAvailability ?? []).some((d) => d.slots.length > 0);
      if (hasPublishedAgenda) {
        // Published agenda → the canonical hourly-slot validator is the single
        // source of truth (template − seat-holding bookings − buffer − min-notice
        // − locks), evaluated for THIS duration.
        const slots = computeHourlySlots(
          mentor,
          input.consultationDate,
          input.durationMinutes,
          mentorBookings,
          { slotLocks: snap.mentorSlotLocks ?? [] },
        );
        const bookable = slots.some((s) => s.start === input.consultationTime && s.available);
        if (!bookable) return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };
      } else {
        // No published agenda (manual-mode booking): the template check would
        // reject EVERY time, so enforce the same guarantees directly —
        // min-notice, blocked dates, and no overlap with a seat-holding session.
        const minNotice = mentor.minNoticeHours != null ? mentor.minNoticeHours : 24;
        const startMs = Date.parse(`${input.consultationDate}T${input.consultationTime}:00+01:00`);
        if (Number.isNaN(startMs) || startMs < Date.now() + Math.max(0, minNotice) * 3_600_000) {
          return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };
        }
        if ((mentor.blockedDates ?? []).includes(input.consultationDate)) {
          return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };
        }
        const endMs = startMs + input.durationMinutes * 60_000;
        const overlapping = mentorBookings.some((b) => {
          if (!mentorBookingHoldsSeat(b.status)) return false;
          if (b.consultationDate !== input.consultationDate || !b.consultationTime) return false;
          const bStart = Date.parse(`${b.consultationDate}T${b.consultationTime}:00+01:00`);
          if (Number.isNaN(bStart)) return false;
          const bEnd = bStart + (b.durationMinutes ?? 60) * 60_000;
          return startMs < bEnd && bStart < endMs;
        });
        if (overlapping) return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };
      }

      const lock = await lockSlot({
        bookingId,
        mentorId: mentor.id,
        date: input.consultationDate,
        startTime: input.consultationTime,
        durationMinutes: input.durationMinutes,
      });
      if (!lock.ok) return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };
      slotLocked = true;
    }
  }

  // ── Zero amount → confirm immediately, no payment ──────────────────────────
  if (gross <= 0) {
    const result = await db.update<{ booking: MentorBookingRecord; replayed: boolean }>((d) => {
      ensureArrays(d);
      const existing = findReplay(d, input);
      if (existing) return { booking: existing, replayed: true };
      const booking = baseBooking(input, now, {
        status: settled.status,
        paymentStatus: 'PAID',
        meetingMode: settled.meetingMode,
        meetingLink: settled.meetingLink,
        meetingAddress: settled.meetingAddress,
        meetingMapsLink: settled.meetingMapsLink,
        amountCharged: 0,
        guestAmountDue: 0,
      }, charge, bookingId);
      d.mentorBookings.push(booking);
      return { booking, replayed: false };
    });
    // Consume the promo only if it actually won (stored on the booking). A tier
    // discount that beat the promo leaves appliedPromoCode null → no consumption.
    if (!result.replayed && result.booking.appliedPromoCode) {
      await consumePromoCode(result.booking.appliedPromoCode);
    }
    // Gross is 0 here, but a FULL-PROMO (PAID) booking still pays the consultant
    // on the full base price — the platform absorbs the whole discount. The
    // helper no-ops for free-mentor bookings.
    if (!result.replayed) await creditMentorForSettledBooking(result.booking);
    // Settled booking now occupies the slot — the transient hold can go.
    if (slotLocked) await releaseSlot(bookingId);
    // Notify the consultant of the new booking (once) and the client: full
    // meeting details when READY, otherwise a "request received" acknowledgment
    // (each self-deduped, so replays never re-send). AWAITED — unawaited sends
    // are killed when the serverless response returns.
    if (!result.replayed) await sendBookingNotificationOnce(result.booking.id);
    if (result.booking.status === 'READY') await sendConsultationReadyOnce(result.booking.id);
    else await sendConsultationReceivedOnce(result.booking.id);
    return { ok: true, mode: 'confirmed', booking: result.booking, replayed: result.replayed };
  }

  // ── Guest → PENDING_PAYMENT; settled by the existing guest pay route ───────
  if (isGuest) {
    const result = await db.update<{ booking: MentorBookingRecord; replayed: boolean }>((d) => {
      ensureArrays(d);
      const existing = findReplay(d, input);
      if (existing) return { booking: existing, replayed: true };
      const booking = baseBooking(input, now, {
        paymentStatus: 'AWAITING_PAYMENT',
        amountCharged: gross,
        guestAmountDue: gross,
        payToken,
        payTokenExpiresAt,
        paymentProviderRef: null,
      }, charge, bookingId);
      d.mentorBookings.push(booking);
      return { booking, replayed: false };
    });
    // Acknowledge the request by email right away (self-deduped) — the guest
    // hears from us even before completing the hosted checkout.
    await sendConsultationReceivedOnce(result.booking.id);
    return {
      ok: true,
      mode: 'awaiting_payment',
      booking: result.booking,
      payToken: result.booking.payToken ?? payToken,
      amount: gross,
    };
  }

  // ── Member: wallet-first ───────────────────────────────────────────────────
  const userId = input.actor!.id;
  type MemberCreate =
    | { kind: 'replay'; booking: MentorBookingRecord }
    | { kind: 'confirmed'; booking: MentorBookingRecord }
    | { kind: 'needs_topup'; booking: MentorBookingRecord; shortfall: number }
    | { kind: 'frozen' };

  const created = await db.update<MemberCreate>((d) => {
    ensureArrays(d);
    const existing = findReplay(d, input);
    if (existing) return { kind: 'replay', booking: existing };

    const wallet = ensureWallet(d, userId, now);
    if (wallet.status === 'FROZEN') return { kind: 'frozen' };

    if (wallet.balance >= gross) {
      // Atomic: debit + write the CONFIRMED booking in one section.
      wallet.balance -= gross;
      wallet.updatedAt = now;
      const tx = pushPaymentTx(d, wallet, userId, gross, input.clientReference, mentor.fullName, input.mentorId, now);
      const booking = baseBooking(input, now, {
        status: settled.status,
        paymentStatus: 'PAID',
        meetingMode: settled.meetingMode,
        meetingLink: settled.meetingLink,
        meetingAddress: settled.meetingAddress,
        meetingMapsLink: settled.meetingMapsLink,
        amountCharged: gross,
        guestAmountDue: gross,
        transactionId: tx.id,
      }, charge, bookingId);
      d.mentorBookings.push(booking);
      return { kind: 'confirmed', booking };
    }

    const booking = baseBooking(input, now, {
      paymentStatus: 'AWAITING_PAYMENT',
      amountCharged: gross,
      guestAmountDue: gross,
      payToken,
      payTokenExpiresAt,
      // Reuse the pre-generated id so it matches the slot-lock's bookingId —
      // otherwise releaseSlot(booking.id) on failure/settlement can't find the
      // hold and it lingers until its TTL (orphaned lock).
    }, charge, bookingId);
    d.mentorBookings.push(booking);
    return { kind: 'needs_topup', booking, shortfall: gross - wallet.balance };
  });

  if (created.kind === 'frozen') return { ok: false, reason: 'WALLET_FROZEN' };
  if (created.kind === 'replay') {
    return replayResult(created.booking, gross);
  }
  if (created.kind === 'confirmed') {
    if (created.booking.appliedPromoCode) await consumePromoCode(created.booking.appliedPromoCode);
    await creditMentorForSettledBooking(created.booking);
    // Settled booking now occupies the slot — the transient hold can go.
    if (slotLocked) await releaseSlot(bookingId);
    await sendBookingNotificationOnce(created.booking.id);
    if (created.booking.status === 'READY') await sendConsultationReadyOnce(created.booking.id);
    else await sendConsultationReceivedOnce(created.booking.id);
    return { ok: true, mode: 'confirmed', booking: created.booking, replayed: false };
  }

  // needs_topup → initiate a SlickPay top-up for the shortfall.
  const topUpAmount = Math.max(created.shortfall, MIN_TOPUP);
  const base = input.appBaseUrl.replace(/\/$/, '');
  const localeSeg = input.locale ?? 'fr';
  const returnUrl = `${base}/${localeSeg}/consultation/instant/${created.booking.payToken}`;
  const top = await initiateTopUp({
    userId,
    amount: topUpAmount,
    returnUrl,
    customer: { fullName: input.name, email: input.email, phone: input.phone },
  });
  if (!top.ok) {
    // Payment couldn't start — release the hold so the slot frees up immediately.
    if (slotLocked) await releaseSlot(created.booking.id);
    return { ok: false, reason: 'PROVIDER_FAILED', message: 'message' in top ? top.message : undefined };
  }

  await db.update((d) => {
    const b = (d.mentorBookings ?? []).find((x) => x.id === created.booking.id);
    if (b) { b.topUpIntentId = top.topUp.id; b.updatedAt = new Date().toISOString(); }
  });

  // Synchronous provider (mock sync): the top-up already credited the wallet —
  // settle the booking now and report CONFIRMED.
  if (top.transaction) {
    const settled = await settleMemberTopUp(created.booking.payToken!);
    if (settled.state === 'CONFIRMED' && settled.booking) {
      return { ok: true, mode: 'confirmed', booking: settled.booking, replayed: false };
    }
  }

  return {
    ok: true,
    mode: 'awaiting_payment',
    booking: created.booking,
    payToken: created.booking.payToken!,
    redirectUrl: top.topUp.redirectUrl,
    amount: gross,
  };
}

/* ───────────────────────────── Member top-up settlement ───────────────────────────── */

export type SettleMemberState = 'INVALID' | 'AWAITING_PAYMENT' | 'CONFIRMED' | 'EXPIRED';

export interface SettleMemberResult {
  state: SettleMemberState;
  booking?: MentorBookingRecord;
}

/**
 * Verify a member's top-up and, once it has settled, debit the wallet for the
 * consultation and confirm the booking. Idempotent: the PENDING_PAYMENT →
 * CONFIRMED transition is claimed inside one mutation, so refreshes / double
 * returns settle exactly once. Never trusts the redirect — reads the top-up
 * intent's status (driven by the provider webhook / sync result).
 */
export async function settleMemberTopUp(token: string): Promise<SettleMemberResult> {
  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find(
    (b) => b.source !== 'guest' && b.payToken === token,
  );
  if (!booking) return { state: 'INVALID' };
  // 'PAID' is the settled marker; the lifecycle status is READY / AWAITING_LINK.
  if (booking.paymentStatus === 'PAID') {
    return { state: 'CONFIRMED', booking };
  }
  if (
    typeof booking.payTokenExpiresAt === 'string' &&
    new Date(booking.payTokenExpiresAt).getTime() < Date.now()
  ) {
    return { state: 'EXPIRED', booking };
  }
  if (!booking.topUpIntentId) return { state: 'AWAITING_PAYMENT', booking };

  const topUp = await getTopUp(booking.topUpIntentId);
  if (!topUp || topUp.status !== 'COMPLETED') return { state: 'AWAITING_PAYMENT', booking };

  const gross = booking.amountCharged ?? booking.guestAmountDue ?? 0;
  const mentor = await findMentorById(booking.mentorId);
  const settled = mentor
    ? resolveSettledStatus(mentor)
    : ({ status: 'AWAITING_LINK', meetingMode: null, meetingLink: null, meetingAddress: null, meetingMapsLink: null } as const);

  const claim = await db.update<{ booking: MentorBookingRecord; claimed: boolean } | null>((d) => {
    const b = (d.mentorBookings ?? []).find((x) => x.id === booking.id);
    if (!b) return null;
    if (b.paymentStatus === 'PAID') return { booking: b, claimed: false };

    const wallet = (d.wallets ?? []).find((w) => w.userId === b.userId);
    if (!wallet || wallet.status === 'FROZEN' || wallet.balance < gross) {
      // Top-up completed but funds not debitable — leave PENDING_PAYMENT for retry.
      return { booking: b, claimed: false };
    }
    const now = new Date().toISOString();
    wallet.balance -= gross;
    wallet.updatedAt = now;
    const tx = pushPaymentTx(d, wallet, b.userId ?? '', gross, `instant-consult-${b.id}`, '', b.mentorId, now);
    b.status = settled.status;
    b.paymentStatus = 'PAID';
    b.meetingMode = settled.meetingMode;
    b.meetingLink = settled.meetingLink;
    b.meetingAddress = settled.meetingAddress;
    b.meetingMapsLink = settled.meetingMapsLink;
    b.transactionId = tx.id;
    b.updatedAt = now;
    return { booking: b, claimed: true };
  });

  if (!claim) return { state: 'INVALID' };
  if (claim.claimed) {
    if (claim.booking.appliedPromoCode) await consumePromoCode(claim.booking.appliedPromoCode);
    await creditMentorForSettledBooking(claim.booking);
    // Settled booking now occupies the slot — drop the transient hold.
    await releaseSlot(claim.booking.id);
    await sendBookingNotificationOnce(claim.booking.id);
    if (claim.booking.status === 'READY') await sendConsultationReadyOnce(claim.booking.id);
    else await sendConsultationReceivedOnce(claim.booking.id);
  }
  return { state: claim.booking.paymentStatus === 'PAID' ? 'CONFIRMED' : 'AWAITING_PAYMENT', booking: claim.booking };
}

/* ───────────────────────────── Small shared writers ───────────────────────────── */

function findReplay(d: StoreDraft, input: CreateInstantBookingInput): MentorBookingRecord | undefined {
  const isGuest = !input.actor;
  return (d.mentorBookings ?? []).find((b) =>
    isGuest
      ? b.source === 'guest' && b.clientReference === input.clientReference
      : b.userId === input.actor!.id && b.clientReference === input.clientReference,
  );
}

function pushPaymentTx(
  d: StoreDraft,
  wallet: WalletRecord,
  userId: string,
  amount: number,
  reference: string,
  mentorName: string,
  mentorId: string,
  now: string,
): TransactionRecord {
  const tx: TransactionRecord = {
    id: randomUUID(),
    walletId: wallet.id,
    userId,
    type: 'PAYMENT',
    amount: -amount,
    balanceAfter: wallet.balance,
    status: 'COMPLETED',
    description: mentorName ? `Consultation booking — ${mentorName}` : 'Consultation booking',
    reference,
    provider: 'internal',
    providerTxnId: null,
    metadata: { bookingItemKind: 'CONSULTATION', mentorId },
    createdAt: now,
    completedAt: now,
  };
  d.transactions.push(tx);
  return tx;
}

function replayResult(booking: MentorBookingRecord, gross: number): CreateInstantBookingResult {
  if (booking.status === 'CONFIRMED' || booking.paymentStatus === 'PAID') {
    return { ok: true, mode: 'confirmed', booking, replayed: true };
  }
  return {
    ok: true,
    mode: 'awaiting_payment',
    booking,
    payToken: booking.payToken ?? '',
    redirectUrl: null,
    amount: booking.amountCharged ?? booking.guestAmountDue ?? gross,
  };
}
