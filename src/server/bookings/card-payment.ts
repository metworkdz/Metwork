/**
 * Card-settled bookings — SPACE / PROGRAM / EVENT.
 *
 * This is the money-critical sibling of the wallet booking flow in
 * `service.ts`. It powers two surfaces that pay by CARD (CIB / Edahabia via the
 * hosted SlickPay checkout) instead of the Metwork wallet:
 *
 *   - ONLINE_FULL  — the client pays the WHOLE total T online by card.
 *   - CASH_DEPOSIT — the client pays a DEPOSIT D online by card; the remaining
 *                    balance T − D is collected in cash on site by the incubator.
 *
 * Guarantees (mirroring the guest-consultation flow):
 *   - T, D and C are ALWAYS recomputed server-side here; the client never
 *     supplies a price. D and C come from `pricing.ts`, the single source of
 *     money math.
 *   - The PENDING_PAYMENT intent holds NO seat (see `attendance.ts` /
 *     `findSpaceOverlapConflict`), so an abandoned checkout never blocks a paid
 *     booking. A binding capacity / overlap re-check runs at settlement.
 *   - Settlement is idempotent: the CONFIRMED transition is claimed via
 *     `settledAt` inside one store mutation, so replays (refresh, double return,
 *     webhook + return) move money exactly once. The promo is consumed only on
 *     the claiming transition.
 *   - Payment is only ever confirmed by asking the provider directly
 *     (`getSlickPayTransferStatus`) or by a synchronous provider result — never
 *     by trusting the browser redirect.
 *
 * Money model — central commission engine (src/server/payments/commission.ts):
 *   The buyer is charged the online base portion P (deposit D for CASH_DEPOSIT,
 *   total T for ONLINE_FULL) PLUS a payer fee (default 2 % of P) frozen at
 *   intent. At settlement the provider wallet moves:
 *     +onlinePaidAmount   (PAYOUT — the online BASE money received, P)
 *     −commissionAmount   (COMMISSION — receiver cut on P, default 5 %)
 *   Because the receiver commission is taken on the ONLINE portion P (never the
 *   cash remainder), net = P − commission is always ≥ 0 — no negative debt.
 *   FLAT/Pro incubators are exempt from the receiver commission (credited the
 *   full P) but their buyers still pay the payer fee. The payer fee is platform
 *   revenue and is never credited to the provider.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type BookingItemKind,
  type BookingRecord,
  type BookingPaymentMode,
  type BookingUnit,
  type IncubatorRecord,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import { countAttendance } from '@/server/attendance';
import { computeDeposit } from './pricing';
import { effectiveListingPrice } from './listing-payment';
import {
  computeCommission as quoteCommission,
  type ProviderPlan,
} from '@/server/payments/commission';
import { getEffectiveSubscriptionCode } from '@/server/incubator/service';
import {
  computeQuantity,
  validateWorkingHours,
  overlapsBlockedDates,
  unitPrice,
  availableUnits,
  findSpaceOverlapConflict,
  countSpaceConcurrent,
} from './service';
import {
  validatePromoCodeSync,
  consumePromoCodeSync,
  ensurePromoCodesSeeded,
} from '@/server/promo-codes/service';
import { getActiveProvider } from '@/server/payments/registry';
import { getSlickPayTransferStatus } from '@/server/payments/slickpay-provider';
import { ProviderNotConfiguredError } from '@/server/payments/errors';
import { sendBookingReceiptEmail } from '@/server/notifications/mock';

/** Pay tokens live for 7 days — long enough to finish a hosted checkout. */
const PAY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ──────────────────────────── Inputs / outputs ──────────────────────────── */

export type CardBookingTarget =
  | { itemKind: 'SPACE'; spaceId: string; unit: BookingUnit; startsAt: string; endsAt: string }
  | { itemKind: 'PROGRAM'; programId: string }
  | { itemKind: 'EVENT'; eventId: string };

export interface CreateCardBookingInput {
  target: CardBookingTarget;
  /** ONLINE_FULL = pay T online; CASH_DEPOSIT = pay D online, T−D cash on site. */
  paymentMode: BookingPaymentMode;
  /** Registered platform user id, or null/undefined for a guest booking. */
  userId?: string | null;
  customer: { fullName: string; email: string; phone: string; idNumber?: string | null };
  /** Idempotency key for this create call. */
  clientReference: string;
  promoCode?: string | null;
  /** Server-derived membership discount fraction (0–1). 0 for guests. */
  membershipDiscount?: number;
  /** Locale for the hosted-checkout return + receipts. */
  locale?: string;
}

export type CreateCardBookingReason =
  | 'ITEM_NOT_FOUND'
  | 'MODE_NOT_ACCEPTED'
  | 'DEPOSIT_NOT_CONFIGURED'
  | 'INVALID_DEPOSIT_CONFIG'
  | 'INVALID_TOTAL'
  | 'UNIT_NOT_AVAILABLE'
  | 'OUTSIDE_WORKING_HOURS'
  | 'NOT_A_WORKING_DAY'
  | 'DATE_UNAVAILABLE'
  | 'OVERLAP_CONFLICT'
  | 'CAPACITY_EXCEEDED'
  | 'DEADLINE_PASSED'
  | 'EVENT_PASSED'
  | 'ALREADY_BOOKED';

export type CreateCardBookingResult =
  | { ok: true; replayed: boolean; booking: BookingRecord; token: string }
  | { ok: false; reason: CreateCardBookingReason; detail?: Record<string, unknown> };

export type CardPayState =
  | 'INVALID'
  | 'EXPIRED'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'SLOT_TAKEN';

export interface CardPayView {
  state: CardPayState;
  booking?: BookingRecord;
  /** Base online portion P (deposit D for CASH_DEPOSIT, total T for ONLINE_FULL), fee EXCLUDED. */
  onlineAmount?: number;
  /** Payer fee added on top of P (default 2 %). 0 for legacy/fee-free bookings. */
  payerFee?: number;
  /** GROSS charged online now = onlineAmount + payerFee. What the buyer actually pays. */
  onlineCharge?: number;
  total?: number;
  cashRemaining?: number;
  paymentMode?: BookingPaymentMode;
}

/* ──────────────────────────── Internal helpers ──────────────────────────── */

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

function ensureWallet(d: StoreDraft, userId: string): WalletRecord {
  let wallet = d.wallets.find((w) => w.userId === userId);
  if (!wallet) {
    const now = new Date().toISOString();
    wallet = {
      id: randomUUID(),
      userId,
      balance: 0,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    d.wallets.push(wallet);
  }
  return wallet;
}

/** Resolve the incubator record that owns a SPACE / PROGRAM / EVENT. */
function findOwningIncubator(
  d: StoreDraft,
  kind: BookingItemKind,
  itemId: string,
): IncubatorRecord | null {
  let incubatorId: string | undefined;
  if (kind === 'SPACE') incubatorId = d.spaces?.find((s) => s.id === itemId)?.incubatorId;
  else if (kind === 'PROGRAM') incubatorId = d.programs?.find((p) => p.id === itemId)?.incubatorId;
  else incubatorId = d.events?.find((e) => e.id === itemId)?.incubatorId;
  if (!incubatorId) return null;
  return d.incubators.find((i) => i.id === incubatorId) ?? null;
}

interface ResolvedItem {
  itemId: string;
  itemName: string;
  vendorName: string;
  city: string;
  unit: BookingUnit;
  quantity: number;
  startsAt: string;
  endsAt: string;
  /** Pre-promo total T after any membership discount. */
  total: number;
  acceptedPaymentMethods: ('ONLINE' | 'CASH')[];
  cashDepositType?: 'FIXED' | 'PERCENT';
  cashDepositValue?: number;
  /** Promo category for validation. */
  promoKind: 'SPACE' | 'PROGRAM' | 'EVENT';
}

type ResolveResult =
  | { ok: true; item: ResolvedItem }
  | { ok: false; reason: CreateCardBookingReason; detail?: Record<string, unknown> };

/**
 * Validate the target listing and compute the pre-promo total T (with any
 * server-derived membership discount applied). Pure read against a snapshot;
 * the binding capacity check runs again at settlement.
 */
function resolveTarget(
  data: Awaited<ReturnType<typeof db.read>>,
  input: CreateCardBookingInput,
): ResolveResult {
  const fraction = Math.min(1, Math.max(0, input.membershipDiscount ?? 0));
  const activeInc = (id: string) =>
    (data.incubators ?? []).some((i) => i.id === id && i.status === 'ACTIVE');
  // Booking surface selects the base price: ONLINE_FULL → online price,
  // CASH_DEPOSIT → cash price (with per-listing fallback to the single price).
  const priceMode: BookingPaymentMode =
    input.paymentMode === 'CASH_DEPOSIT' ? 'CASH_DEPOSIT' : 'ONLINE_FULL';

  if (input.target.itemKind === 'SPACE') {
    const t = input.target;
    const rec = (data.spaces ?? []).find((s) => s.id === t.spaceId);
    if (!rec || !rec.isActive || !activeInc(rec.incubatorId)) return { ok: false, reason: 'ITEM_NOT_FOUND' };

    const price = unitPrice(rec, t.unit, priceMode);
    if (price == null) {
      return { ok: false, reason: 'UNIT_NOT_AVAILABLE', detail: { available: availableUnits(rec) } };
    }
    const wh = validateWorkingHours(t.startsAt, t.endsAt, rec);
    if (wh === 'NOT_A_WORKING_DAY') {
      return { ok: false, reason: 'NOT_A_WORKING_DAY', detail: { workingDays: rec.workingDays ?? [1, 2, 3, 4, 5] } };
    }
    if (wh === 'OUTSIDE_WORKING_HOURS') {
      return { ok: false, reason: 'OUTSIDE_WORKING_HOURS', detail: { openingTime: rec.openingTime, closingTime: rec.closingTime } };
    }
    const quantity = computeQuantity(t.startsAt, t.endsAt, t.unit);
    if (rec.unavailableDates?.length && overlapsBlockedDates(rec.unavailableDates, t.startsAt, t.endsAt, t.unit, quantity)) {
      return { ok: false, reason: 'DATE_UNAVAILABLE', detail: { blockedDates: rec.unavailableDates } };
    }
    const raw = price * quantity;
    const total = fraction > 0 ? Math.round(raw * (1 - fraction)) : raw;
    return {
      ok: true,
      item: {
        itemId: rec.id,
        itemName: rec.name,
        vendorName: rec.incubatorName,
        city: rec.city,
        unit: t.unit,
        quantity,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        total,
        acceptedPaymentMethods: rec.acceptedPaymentMethods,
        cashDepositType: rec.cashDepositType,
        cashDepositValue: rec.cashDepositValue,
        promoKind: 'SPACE',
      },
    };
  }

  if (input.target.itemKind === 'PROGRAM') {
    const rec = (data.programs ?? []).find((p) => p.id === (input.target as { programId: string }).programId);
    if (!rec || !rec.isActive || !activeInc(rec.incubatorId)) return { ok: false, reason: 'ITEM_NOT_FOUND' };
    if (Date.parse(rec.deadline) <= Date.now()) return { ok: false, reason: 'DEADLINE_PASSED', detail: { deadline: rec.deadline } };
    return {
      ok: true,
      item: {
        itemId: rec.id,
        itemName: rec.title,
        vendorName: rec.incubatorName,
        city: rec.city,
        unit: 'DAY',
        quantity: 1,
        startsAt: rec.startDate,
        endsAt: rec.endDate,
        total: effectiveListingPrice(rec.price, rec, priceMode),
        acceptedPaymentMethods: rec.acceptedPaymentMethods,
        cashDepositType: rec.cashDepositType,
        cashDepositValue: rec.cashDepositValue,
        promoKind: 'PROGRAM',
      },
    };
  }

  // EVENT
  const rec = (data.events ?? []).find((e) => e.id === (input.target as { eventId: string }).eventId);
  if (!rec || !rec.isActive || !activeInc(rec.incubatorId)) return { ok: false, reason: 'ITEM_NOT_FOUND' };
  if (Date.parse(rec.eventDate) <= Date.now()) return { ok: false, reason: 'EVENT_PASSED', detail: { eventDate: rec.eventDate } };
  const eventBase = effectiveListingPrice(rec.price, rec, priceMode);
  const total = fraction > 0 && eventBase > 0 ? Math.round(eventBase * (1 - fraction)) : eventBase;
  return {
    ok: true,
    item: {
      itemId: rec.id,
      itemName: rec.title,
      vendorName: rec.incubatorName,
      city: rec.city,
      unit: 'HOUR',
      quantity: 1,
      startsAt: rec.eventDate,
      endsAt: rec.eventDate,
      total,
      acceptedPaymentMethods: rec.acceptedPaymentMethods,
      cashDepositType: rec.cashDepositType,
      cashDepositValue: rec.cashDepositValue,
      promoKind: 'EVENT',
    },
  };
}

/* ──────────────────────────── Intent creation ──────────────────────────── */

/**
 * Create a PENDING_PAYMENT card-booking intent. Computes T, D server-side,
 * freezes them on the booking, and returns a single-use pay token. Holds NO
 * seat — capacity is re-checked at settlement.
 */
export async function createCardBookingIntent(
  input: CreateCardBookingInput,
): Promise<CreateCardBookingResult> {
  if (input.promoCode) await ensurePromoCodesSeeded();

  const snapshot = await db.read();
  const resolved = resolveTarget(snapshot, input);
  if (!resolved.ok) return resolved;
  const item = resolved.item;

  // Listing must accept the chosen surface.
  const needs = input.paymentMode === 'CASH_DEPOSIT' ? 'CASH' : 'ONLINE';
  if (!item.acceptedPaymentMethods?.includes(needs)) {
    return { ok: false, reason: 'MODE_NOT_ACCEPTED' };
  }
  if (item.total <= 0) return { ok: false, reason: 'INVALID_TOTAL' };

  // Online amount charged now: deposit D for CASH_DEPOSIT, full T for ONLINE_FULL.
  let onlinePaidAmount: number;
  let cashRemainingAmount: number;
  if (input.paymentMode === 'CASH_DEPOSIT') {
    const dep = computeDeposit(item.total, {
      cashDepositType: item.cashDepositType ?? null,
      cashDepositValue: item.cashDepositValue ?? null,
    });
    if (!dep.ok) {
      return {
        ok: false,
        reason: dep.reason === 'INVALID_CONFIG' ? 'INVALID_DEPOSIT_CONFIG'
          : dep.reason === 'NOT_CONFIGURED' ? 'DEPOSIT_NOT_CONFIGURED'
          : 'INVALID_TOTAL',
      };
    }
    onlinePaidAmount = dep.deposit;
    cashRemainingAmount = item.total - dep.deposit;
  } else {
    onlinePaidAmount = item.total;
    cashRemainingAmount = 0;
  }

  return db.update<CreateCardBookingResult>((d) => {
    // Idempotency: same (userId, clientReference) → return the existing intent.
    const replay = d.bookings.find(
      (b) => (b.userId ?? null) === (input.userId ?? null) && b.clientReference === input.clientReference,
    );
    if (replay) {
      return { ok: true, replayed: true, booking: replay, token: replay.payToken ?? '' };
    }

    // Registered single-active-application guard for PROGRAM / EVENT.
    if (input.userId && (item.promoKind === 'PROGRAM' || item.promoKind === 'EVENT')) {
      const active = d.bookings.find(
        (b) =>
          b.userId === input.userId &&
          b.itemKind === item.promoKind &&
          b.itemId === item.itemId &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED' &&
          b.status !== 'PENDING_PAYMENT',
      );
      if (active) return { ok: false, reason: 'ALREADY_BOOKED', detail: { existingBookingId: active.id } };
    }

    // Courtesy capacity / overlap check (binding one runs at settlement).
    if (item.promoKind === 'SPACE') {
      const conflictId = findSpaceOverlapConflict(d.bookings, item.itemId, item.startsAt, item.endsAt);
      if (conflictId) return { ok: false, reason: 'OVERLAP_CONFLICT', detail: { conflictingBookingId: conflictId } };
      const space = d.spaces?.find((s) => s.id === item.itemId);
      const taken = countSpaceConcurrent(d.bookings, item.itemId, item.startsAt, item.endsAt);
      if (space && taken >= space.capacity) {
        return { ok: false, reason: 'CAPACITY_EXCEEDED', detail: { capacity: space.capacity, taken } };
      }
    } else {
      const cap = item.promoKind === 'PROGRAM'
        ? d.programs?.find((p) => p.id === item.itemId)?.seatsTotal ?? 0
        : d.events?.find((e) => e.id === item.itemId)?.capacity ?? 0;
      const taken = countAttendance(d, item.promoKind, item.itemId);
      if (taken >= cap) return { ok: false, reason: 'CAPACITY_EXCEEDED', detail: { capacity: cap, taken } };
    }

    // Promo: validate now to freeze the discounted total, but DON'T consume —
    // an abandoned intent must never burn a code. Consumed at settlement.
    let total = item.total;
    let promoCodeId: string | null = null;
    if (input.promoCode && input.promoCode.trim()) {
      const promo = validatePromoCodeSync(d.promoCodes ?? [], input.promoCode, item.total, item.promoKind);
      if (promo.valid) {
        total = promo.finalAmount;
        promoCodeId = promo.promoCodeId;
        // Re-derive the online split against the discounted total.
        if (input.paymentMode === 'CASH_DEPOSIT') {
          const dep = computeDeposit(total, {
            cashDepositType: item.cashDepositType ?? null,
            cashDepositValue: item.cashDepositValue ?? null,
          });
          if (dep.ok) {
            onlinePaidAmount = dep.deposit;
            cashRemainingAmount = total - dep.deposit;
          }
        } else {
          onlinePaidAmount = total;
          cashRemainingAmount = 0;
        }
      }
    }
    if (total <= 0) return { ok: false, reason: 'INVALID_TOTAL' };

    // ── Freeze the payer-side fee on the online portion P (central engine) ──
    // The buyer is charged P + payerFee online; the fee is locked here so the
    // pay page and the hosted-checkout amount honor the quote at intent time.
    // The receiver commission is (re)computed at settlement against the plan.
    const feeIncubator = findOwningIncubator(d, item.promoKind, item.itemId);
    const feePlan: ProviderPlan = feeIncubator
      ? getEffectiveSubscriptionCode(feeIncubator)
      : 'COMMISSION';
    const feeQuote = quoteCommission({
      transactionType: 'PAYMENT',
      providerPlan: feePlan,
      baseAmount: onlinePaidAmount,
      config: d.meta?.platformConfig,
    });

    const now = new Date().toISOString();
    const token = randomUUID();
    const booking: BookingRecord = {
      id: randomUUID(),
      userId: input.userId ?? null,
      source: 'online',
      paymentMethod: 'card',
      clientName: input.customer.fullName,
      clientPhone: input.customer.phone,
      clientEmail: input.customer.email,
      clientIdNumber: input.customer.idNumber ?? null,
      itemKind: item.promoKind,
      itemId: item.itemId,
      itemName: item.itemName,
      vendorName: item.vendorName,
      city: item.city,
      unit: item.unit,
      quantity: item.quantity,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      totalAmount: total,
      status: 'PENDING_PAYMENT',
      clientReference: input.clientReference,
      transactionId: null,
      promoCodeId: promoCodeId,
      paymentMode: input.paymentMode,
      onlinePaidAmount,
      cashRemainingAmount,
      payerFeeAmount: feeQuote.payerFee,
      payerFeeRate: feeQuote.payerRate,
      onlineChargeAmount: feeQuote.grossChargedToPayer,
      paymentStatus: undefined,
      settledAt: null,
      payToken: token,
      payTokenExpiresAt: new Date(Date.now() + PAY_TOKEN_TTL_MS).toISOString(),
      paymentProviderRef: null,
      bookingLocale: input.locale ?? 'fr',
      createdAt: now,
      updatedAt: now,
    };
    d.bookings.push(booking);
    return { ok: true, replayed: false, booking, token };
  });
}

/* ──────────────────────────── Pay-page views ──────────────────────────── */

function findByToken(d: { bookings: BookingRecord[] }, token: string): BookingRecord | undefined {
  return d.bookings.find(
    (b) => typeof b.payToken === 'string' && b.payToken === token && b.paymentMode != null,
  );
}

function isSettled(b: BookingRecord): boolean {
  return !!b.settledAt || b.status === 'CONFIRMED' || b.status === 'COMPLETED';
}

function isExpired(b: BookingRecord): boolean {
  return typeof b.payTokenExpiresAt === 'string' && new Date(b.payTokenExpiresAt).getTime() < Date.now();
}

function viewFor(b: BookingRecord, state: CardPayState): CardPayView {
  const onlineAmount = b.onlinePaidAmount ?? 0;
  const payerFee = b.payerFeeAmount ?? 0;
  return {
    state,
    booking: b,
    onlineAmount,
    payerFee,
    onlineCharge: b.onlineChargeAmount ?? onlineAmount + payerFee,
    total: b.totalAmount,
    cashRemaining: b.cashRemainingAmount ?? 0,
    paymentMode: b.paymentMode,
  };
}

/** Read-only view for the pay page. Never calls the provider or settles. */
export async function getCardBookingPayView(token: string): Promise<CardPayView> {
  const data = await db.read();
  const booking = findByToken(data, token);
  if (!booking) return { state: 'INVALID' };
  if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
    return viewFor(booking, booking.settledAt ? 'SLOT_TAKEN' : 'CANCELLED');
  }
  if (isSettled(booking)) return viewFor(booking, 'CONFIRMED');
  if (isExpired(booking)) return viewFor(booking, 'EXPIRED');
  return viewFor(booking, 'AWAITING_PAYMENT');
}

/* ──────────────────────────── Settlement ──────────────────────────── */

type SettleOutcome =
  | { kind: 'SETTLED'; booking: BookingRecord; claimed: boolean }
  | { kind: 'SLOT_TAKEN'; booking: BookingRecord }
  | { kind: 'NOT_FOUND' };

/**
 * Atomically claim the CONFIRMED transition and move money. Idempotent — only
 * the first caller flips `settledAt`, credits the incubator (+D/+T), debits the
 * commission (−C) and consumes the promo. Replays are no-ops.
 */
async function applyCardSettlement(bookingId: string, providerRef: string | null): Promise<SettleOutcome> {
  return db.update<SettleOutcome>((d) => {
    const booking = d.bookings.find((b) => b.id === bookingId);
    if (!booking) return { kind: 'NOT_FOUND' };

    // Already settled (or voided after a prior settlement attempt) → replay.
    if (booking.settledAt || booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') {
      return { kind: 'SETTLED', booking, claimed: false };
    }
    if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
      return { kind: 'SLOT_TAKEN', booking };
    }

    const now = new Date().toISOString();

    // ── Binding commit-time capacity / overlap re-check ───────────────────
    // The intent held no seat; another booking may have filled it meanwhile.
    let oversold = false;
    if (booking.itemKind === 'SPACE') {
      const conflictId = findSpaceOverlapConflict(d.bookings, booking.itemId, booking.startsAt, booking.endsAt);
      const space = d.spaces?.find((s) => s.id === booking.itemId);
      const taken = countSpaceConcurrent(d.bookings, booking.itemId, booking.startsAt, booking.endsAt);
      oversold = !!conflictId || (!!space && taken >= space.capacity);
    } else {
      const cap = booking.itemKind === 'PROGRAM'
        ? d.programs?.find((p) => p.id === booking.itemId)?.seatsTotal ?? 0
        : d.events?.find((e) => e.id === booking.itemId)?.capacity ?? 0;
      const taken = countAttendance(d, booking.itemKind, booking.itemId);
      oversold = taken >= cap;
    }

    if (oversold) {
      // The client already paid online but the slot is gone. Void the booking
      // and stamp settledAt so this is processed exactly once. The online
      // payment must be refunded MANUALLY (logged for the operator).
      booking.status = 'CANCELLED';
      booking.settledAt = now;
      booking.declineReason = 'SLOT_TAKEN_AFTER_PAYMENT';
      if (providerRef) booking.paymentProviderRef = providerRef;
      booking.updatedAt = now;
      return { kind: 'SLOT_TAKEN', booking };
    }

    // ── Commit the seat ───────────────────────────────────────────────────
    booking.status = 'CONFIRMED';
    booking.settledAt = now;
    booking.paymentStatus = booking.paymentMode === 'CASH_DEPOSIT' ? 'AWAITING_CASH' : 'PAID';
    if (providerRef) booking.paymentProviderRef = providerRef;
    booking.updatedAt = now;

    // ── Incubator wallet: +online base received, −receiver commission ─────
    // Central commission engine. Receiver commission is taken on the ONLINE
    // portion P (deposit D or full T) — never the cash remainder — so the net
    // credited (P − commission) is always ≥ 0. FLAT/Pro incubators are exempt.
    const incubator = findOwningIncubator(d, booking.itemKind, booking.itemId);
    const online = booking.onlinePaidAmount ?? 0;
    const providerPlan: ProviderPlan = incubator
      ? getEffectiveSubscriptionCode(incubator)
      : 'COMMISSION';
    const quote = quoteCommission({
      transactionType: 'PAYMENT',
      providerPlan,
      baseAmount: online,
      config: d.meta?.platformConfig,
    });
    const commission = quote.receiverCommission;
    booking.commissionRate = quote.receiverRate;
    booking.commissionAmount = commission;
    if (incubator?.managerId) {
      const wallet = ensureWallet(d, incubator.managerId);
      // Credit the online card money received (deposit or full).
      if (online > 0 && wallet.status !== 'FROZEN') {
        wallet.balance += online;
        wallet.updatedAt = now;
        const payoutTx: TransactionRecord = {
          id: randomUUID(),
          walletId: wallet.id,
          userId: incubator.managerId,
          type: 'PAYOUT',
          amount: online,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: `Booking online payment — ${booking.itemName}`,
          reference: `payout-${booking.id}`,
          provider: 'internal',
          providerTxnId: providerRef,
          metadata: {
            bookingId: booking.id,
            customerId: booking.userId,
            paymentMode: booking.paymentMode,
            total: booking.totalAmount,
          },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(payoutTx);
      }
      // Debit the receiver commission on the ONLINE portion P. Net stays ≥ 0
      // (commission ≤ P), so no negative-balance debt under the engine model.
      if (commission > 0 && wallet.status !== 'FROZEN') {
        wallet.balance -= commission;
        wallet.updatedAt = now;
        const commissionTx: TransactionRecord = {
          id: randomUUID(),
          walletId: wallet.id,
          userId: incubator.managerId,
          type: 'COMMISSION',
          amount: -commission,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: `Platform commission — ${booking.itemName}`,
          reference: `commission-${booking.id}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: {
            bookingId: booking.id,
            total: booking.totalAmount,
            base: online,
            rate: quote.receiverRate,
            payerFee: booking.payerFeeAmount ?? 0,
            payerRate: booking.payerFeeRate ?? 0,
            platformTake: quote.platformTake,
          },
          createdAt: now,
          completedAt: now,
        };
        d.transactions.push(commissionTx);
      }
    }

    // ── Consume the promo exactly once, on the claiming transition ────────
    if (booking.promoCodeId) consumePromoCodeSync(d.promoCodes ?? [], booking.promoCodeId);

    return { kind: 'SETTLED', booking, claimed: true };
  });
}

/**
 * Issue the card-booking receipt that is currently due, exactly once.
 *
 *  - ONLINE_FULL settled → 'final' receipt (paid in full).
 *  - CASH_DEPOSIT settled → interim 'deposit' receipt (balance still due).
 *  - CASH_DEPOSIT cash collected → 'final' receipt (paid in full).
 *
 * The matching dedup stamp (depositReceiptSentAt / finalReceiptSentAt) is
 * claimed inside one store mutation, so replays (refresh, double return,
 * webhook + return) and the mark-cash-paid action each send at most once.
 * Fully fire-and-forget: never throws into the money path, never blocks.
 */
interface ReceiptClaim {
  variant: 'deposit' | 'final';
  booking: BookingRecord;
  incubator: IncubatorRecord;
  clientEmail: string;
  clientName: string;
  lang: 'en' | 'fr';
}

export async function dispatchCardReceiptIfDue(bookingId: string): Promise<void> {
  try {
    let claim: ReceiptClaim | null = null;

    await db.update((d) => {
      const b = d.bookings.find((x) => x.id === bookingId);
      if (!b || b.paymentMethod !== 'card') return;

      const incubator = findOwningIncubator(d, b.itemKind, b.itemId);
      if (!incubator) return;

      const user = b.userId ? d.users.find((u) => u.id === b.userId) : null;
      const clientEmail = user?.email ?? b.clientEmail ?? '';
      const clientName = user?.fullName ?? b.clientName ?? 'Client';
      if (!clientEmail) return;
      const lang: 'en' | 'fr' = (b.bookingLocale ?? user?.locale) === 'en' ? 'en' : 'fr';

      const now = new Date().toISOString();
      // 'final' takes priority once the booking is paid in full.
      if (b.paymentStatus === 'PAID' && !b.finalReceiptSentAt) {
        b.finalReceiptSentAt = now;
        claim = { variant: 'final', booking: { ...b }, incubator, clientEmail, clientName, lang };
      } else if (
        b.paymentMode === 'CASH_DEPOSIT' &&
        b.paymentStatus === 'AWAITING_CASH' &&
        !b.depositReceiptSentAt
      ) {
        b.depositReceiptSentAt = now;
        claim = { variant: 'deposit', booking: { ...b }, incubator, clientEmail, clientName, lang };
      }
    });

    // `claim` is mutated inside the db.update closure, so TS flow-types it as
    // `null` here — cast back to its real type before the guard.
    const c = claim as ReceiptClaim | null;
    if (!c) return;
    sendBookingReceiptEmail({
      booking: c.booking,
      clientName: c.clientName,
      clientEmail: c.clientEmail,
      incubator: c.incubator,
      lang: c.lang,
      variant: c.variant,
    });
  } catch {
    // Receipts are non-critical — swallow any failure so settlement is unaffected.
  }
}

/**
 * Verify with the provider and settle if paid. Called when the client returns
 * from the hosted checkout. Never trusts the redirect — asks the provider.
 */
export async function verifyAndSettleCardBooking(token: string): Promise<CardPayView> {
  const data = await db.read();
  const booking = findByToken(data, token);
  if (!booking) return { state: 'INVALID' };

  if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
    return viewFor(booking, booking.settledAt ? 'SLOT_TAKEN' : 'CANCELLED');
  }
  if (isSettled(booking)) return viewFor(booking, 'CONFIRMED');

  // No provider reference yet → the client never started checkout.
  if (!booking.paymentProviderRef) {
    if (isExpired(booking)) return viewFor(booking, 'EXPIRED');
    return viewFor(booking, 'AWAITING_PAYMENT');
  }

  // Ask the provider directly. Unconfigured (mock/dev) → treat as not-yet-paid.
  let status: { completed: 0 | 1 };
  try {
    status = await getSlickPayTransferStatus(booking.paymentProviderRef);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      if (isExpired(booking)) return viewFor(booking, 'EXPIRED');
      return viewFor(booking, 'AWAITING_PAYMENT');
    }
    throw err;
  }

  if (status.completed !== 1) {
    if (isExpired(booking)) return viewFor(booking, 'EXPIRED');
    return viewFor(booking, 'AWAITING_PAYMENT');
  }

  const outcome = await applyCardSettlement(booking.id, booking.paymentProviderRef);
  const after = (await db.read()).bookings.find((b) => b.id === booking.id) ?? booking;
  if (outcome.kind === 'SLOT_TAKEN') return viewFor(after, 'SLOT_TAKEN');
  void dispatchCardReceiptIfDue(booking.id);
  return viewFor(after, 'CONFIRMED');
}

/* ──────────────────────────── Checkout init ──────────────────────────── */

export type InitCardBookingResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; reason: CardPayState | 'PROVIDER_FAILED'; message?: string };

/**
 * Create the hosted-checkout transfer lazily (only when the client clicks Pay).
 * Charges `onlinePaidAmount` (deposit or full). Returns the URL to redirect to.
 * A synchronous provider (mock sync) settles immediately.
 */
export async function initCardBookingPayment(
  token: string,
  appBaseUrl: string,
): Promise<InitCardBookingResult> {
  const data = await db.read();
  const booking = findByToken(data, token);
  if (!booking) return { ok: false, reason: 'INVALID' };
  if (booking.status === 'CANCELLED' || booking.status === 'REFUNDED') {
    return { ok: false, reason: booking.settledAt ? 'SLOT_TAKEN' : 'CANCELLED' };
  }
  if (isSettled(booking)) return { ok: false, reason: 'CONFIRMED' };
  if (isExpired(booking)) return { ok: false, reason: 'EXPIRED' };

  // Charge the GROSS online amount = base online portion + payer fee (frozen at
  // intent). Fall back to the base for legacy bookings created before the fee.
  const amount = booking.onlineChargeAmount ?? booking.onlinePaidAmount ?? 0;
  if (amount <= 0) return { ok: false, reason: 'PROVIDER_FAILED', message: 'Nothing to charge online' };

  const base = appBaseUrl.replace(/\/$/, '');
  const localeSeg = booking.bookingLocale ?? 'fr';
  const returnUrl = `${base}/${localeSeg}/booking/pay/${token}`;

  const provider = getActiveProvider();
  let result;
  try {
    result = await provider.initTopUp({
      topUpId: booking.id,
      userId: booking.userId ?? `guest:${booking.id}`,
      amount,
      returnUrl,
      webhookUrl: `${base}/api/webhooks/payments/${provider.code}`,
      customer: {
        fullName: booking.clientName ?? '',
        email: booking.clientEmail ?? '',
        phone: booking.clientPhone ?? '',
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
    const b = d.bookings.find((x) => x.id === booking.id);
    if (b) {
      b.paymentProviderRef = result.providerRef;
      b.updatedAt = new Date().toISOString();
    }
  });

  // Synchronous settlement (mock sync) → settle now, bounce to the pay page.
  if (result.status === 'COMPLETED') {
    await applyCardSettlement(booking.id, result.providerRef);
    void dispatchCardReceiptIfDue(booking.id);
    return { ok: true, redirectUrl: returnUrl };
  }

  if (result.status === 'FAILED' || !result.redirectUrl) {
    return { ok: false, reason: 'PROVIDER_FAILED', message: 'Could not start the payment session' };
  }

  return { ok: true, redirectUrl: result.redirectUrl };
}
