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
  type MentorConsultationRecord,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { computeConsultationCharge } from './pricing';
import { getTopUp, initiateTopUp } from '@/server/wallet/service';
import { consumePromoCode } from '@/server/promo-codes/service';
import { creditPendingEarning } from '@/server/mentors/ledger';
import { resolveSettledStatus } from './lifecycle';

/** Pay tokens live for 7 days — long enough to finish a hosted checkout. */
const PAY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wallet top-up floor (mirrors the wallet service). */
const MIN_TOPUP = 100;

/** Feature flag, read at call-time so tests can toggle per-case. */
export function isInstantBookEnabled(): boolean {
  return process.env.CONSULTATION_INSTANT_BOOK === 'true';
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
  /** Server-authoritative: true only when the member actually has a free credit. */
  useFreeCredit?: boolean;
  /** 'YYYY-MM' the free credit is charged against, when useFreeCredit. */
  freeQuotaMonth?: string | null;
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
  | { ok: false; reason: 'MENTOR_NOT_FOUND' | 'WALLET_FROZEN' | 'PROVIDER_FAILED'; message?: string };

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
): MentorBookingRecord {
  const isGuest = !input.actor;
  return {
    id: randomUUID(),
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
    appliedPromoCode: input.appliedPromoCode ?? null,
    promoDiscountPercent: input.promoDiscountPercent ?? null,
    chargeType: input.useFreeCredit ? 'FREE_QUOTA' : 'PAID',
    freeQuotaMonth: input.useFreeCredit ? (input.freeQuotaMonth ?? null) : null,
    transactionId: null,
    refundTransactionId: null,
    clientReference: input.clientReference,
    source: isGuest ? 'guest' : 'registered',
    guestLocale: input.locale ?? 'fr',
    instantBook: true,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/**
 * Credit the consultant's PENDING balance for a settled consultation, recording
 * the platform commission. Non-blocking: the booking is already CONFIRMED, so a
 * ledger error must never roll it back — it is logged and reconcilable later
 * (the credit is idempotent per booking). No-op for zero-amount bookings.
 */
export async function creditMentorForSettledBooking(
  mentorId: string,
  bookingId: string,
  grossAmount: number,
): Promise<void> {
  if (grossAmount <= 0) return;
  try {
    await creditPendingEarning({ mentorId, bookingId, grossAmount });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[instant-book] mentor credit failed for booking ${bookingId} (settled OK, reconcilable):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Write the FREE_QUOTA consultation row (consumes the monthly credit). */
function writeFreeQuotaConsultation(
  d: StoreDraft,
  booking: MentorBookingRecord,
  mentorName: string,
  now: string,
): void {
  const consultation: MentorConsultationRecord = {
    id: randomUUID(),
    bookingId: booking.id,
    mentorId: booking.mentorId,
    mentorName,
    userId: booking.userId ?? '',
    chargeType: 'FREE_QUOTA',
    amountCharged: 0,
    transactionId: null,
    status: 'CONFIRMED',
    quotaMonth: booking.freeQuotaMonth ?? '',
    message: booking.message,
    durationMinutes: booking.durationMinutes ?? null,
    scheduledAt: booking.scheduledAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  d.mentorConsultations.push(consultation);
}

/* ───────────────────────────── Create ───────────────────────────── */

export async function createInstantBooking(
  input: CreateInstantBookingInput,
): Promise<CreateInstantBookingResult> {
  const mentor = await findMentorById(input.mentorId);
  if (!mentor) return { ok: false, reason: 'MENTOR_NOT_FOUND' };

  const isGuest = !input.actor;
  const { gross } = computeConsultationCharge({
    feePerHour: mentor.consultationFee ?? 0,
    durationMinutes: input.durationMinutes,
    membershipDiscountFraction: isGuest ? 0 : input.actor?.membershipDiscountFraction,
    promoDiscountPercent: input.promoDiscountPercent ?? 0,
    useFreeCredit: input.useFreeCredit,
  });

  const now = new Date().toISOString();
  const payToken = randomUUID();
  const payTokenExpiresAt = new Date(Date.now() + PAY_TOKEN_TTL_MS).toISOString();
  // Post-settlement lifecycle state (READY vs AWAITING_LINK) from the
  // consultant's meeting defaults. `paymentStatus: 'PAID'` remains the settled
  // marker, so the status value is free to be READY / AWAITING_LINK.
  const settled = resolveSettledStatus(mentor);

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
        amountCharged: 0,
        guestAmountDue: 0,
      });
      d.mentorBookings.push(booking);
      if (input.useFreeCredit) writeFreeQuotaConsultation(d, booking, mentor.fullName, now);
      return { booking, replayed: false };
    });
    if (!result.replayed && input.appliedPromoCode) await consumePromoCode(input.appliedPromoCode);
    // P4: creditPendingEarning is a no-op at gross 0; nothing to credit.
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
      });
      d.mentorBookings.push(booking);
      return { booking, replayed: false };
    });
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
        amountCharged: gross,
        guestAmountDue: gross,
        transactionId: tx.id,
      });
      d.mentorBookings.push(booking);
      return { kind: 'confirmed', booking };
    }

    const booking = baseBooking(input, now, {
      paymentStatus: 'AWAITING_PAYMENT',
      amountCharged: gross,
      guestAmountDue: gross,
      payToken,
      payTokenExpiresAt,
    });
    d.mentorBookings.push(booking);
    return { kind: 'needs_topup', booking, shortfall: gross - wallet.balance };
  });

  if (created.kind === 'frozen') return { ok: false, reason: 'WALLET_FROZEN' };
  if (created.kind === 'replay') {
    return replayResult(created.booking, gross);
  }
  if (created.kind === 'confirmed') {
    if (input.appliedPromoCode) await consumePromoCode(input.appliedPromoCode);
    await creditMentorForSettledBooking(created.booking.mentorId, created.booking.id, gross);
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
    : ({ status: 'AWAITING_LINK', meetingMode: null, meetingLink: null } as const);

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
    b.transactionId = tx.id;
    b.updatedAt = now;
    return { booking: b, claimed: true };
  });

  if (!claim) return { state: 'INVALID' };
  if (claim.claimed) {
    if (claim.booking.appliedPromoCode) await consumePromoCode(claim.booking.appliedPromoCode);
    await creditMentorForSettledBooking(claim.booking.mentorId, claim.booking.id, gross);
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
