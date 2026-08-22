/**
 * Booking service. The headline operation is `createSpaceBooking`,
 * which performs the wallet debit and the booking insert inside a
 * single `db.update` critical section so the two writes can never
 * disagree:
 *   - Insufficient funds → no booking, no transaction.
 *   - Replay (same clientReference) → original booking is returned,
 *     the wallet is NOT touched a second time.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type BookingRecord,
  type BookingUnit,
  type TransactionRecord,
  type WalletRecord,
} from '@/server/db/store';
import { findSpaceById } from './space-catalog';
import {
  checkSpaceAvailability,
  bestDurationDiscountPercent,
  applyDiscountPercent,
} from './availability';
import {
  holdDeskForBooking,
  eachDayInRange,
  isDeskFreeInRange,
} from '@/server/spaces/availability';
import { findProgramById } from './program-catalog';
import { findEventById } from './event-catalog';
import { countAttendance } from '@/server/attendance';
import { resolveMemberBenefits } from '@/server/memberships/service';
import { isNetworkPassEnabled } from '@/config/feature-flags';
import { validatePromoCodeSync as validatePromoCode, consumePromoCodeSync as consumePromoCode, ensurePromoCodesSeeded } from '@/server/promo-codes/service';
import type {
  ApplyToProgramResult,
  CreateSpaceBookingResult,
  RegisterForEventResult,
} from './types';

/** Returns the YYYY-MM-DD portion of an ISO datetime string or Date. */
function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

/** True if the booking window [startsAt, endsAt) overlaps any blocked date. */
export function overlapsBlockedDates(
  blockedDates: string[],
  startsAt: string,
  endsAt: string,
  unit: BookingUnit,
  quantity: number,
): boolean {
  if (!blockedDates.length) return false;
  const blocked = new Set(blockedDates);
  const start = new Date(startsAt);
  // Walk through each day in the range
  for (let i = 0; i < quantity; i++) {
    const day = new Date(start);
    if (unit === 'HOUR') {
      // Hour bookings fall on a single day
      return blocked.has(toDateStr(startsAt));
    }
    day.setUTCDate(start.getUTCDate() + i);
    if (blocked.has(day.toISOString().slice(0, 10))) return true;
  }
  void endsAt;
  return false;
}

/**
 * Who is making the booking.
 *
 * `user`   — a platform account (`UserRecord`). Full range of payment methods:
 *            wallet, cash-on-site, Network Pass; membership discounts apply.
 * `mentor` — a consultant booking from the consultant portal. Consultants are a
 *            separate population with NO `UserRecord` and NO Metwork wallet, so
 *            this actor is CASH-ONLY: the booking is reserved here and settled
 *            with the space directly on site. No money moves on Metwork, which
 *            is why this actor needs no payment rail at all.
 *
 * The availability/pricing engine below is shared by both actors — only the
 * identity and the settlement path differ.
 */
export type BookingActor =
  | { type: 'user'; userId: string }
  | {
      type: 'mentor';
      mentorId: string;
      /**
       * Contact details snapshotted onto the booking so the space can reach the
       * consultant. Derived server-side from the mentor record — never supplied
       * by the client.
       */
      contact: { fullName: string; email: string | null; phone: string | null };
    };

export interface CreateSpaceBookingArgs {
  /** Booker identity — see `BookingActor`. */
  booker: BookingActor;
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  clientReference: string;
  promoCode?: string;
  /**
   * Default 'wallet'.
   * - 'manual'        — reserve only, no wallet debit, status PENDING_PAYMENT.
   * - 'NETWORK_PASS'  — redeem one of the user's monthly Network Pass credits.
   *                     Only valid when the target space is enrolled in the
   *                     Partner Program AND the user is BUILDER or FOUNDER tier.
   */
  paymentMethod?: 'wallet' | 'manual' | 'NETWORK_PASS';
  /** Fractional membership discount to apply before the promo code (0–1). e.g. 0.20 = 20 % off. */
  membershipDiscount?: number;
  /**
   * Desk / office unit to reserve — only meaningful for COWORKING (must match a
   * name in space.deskNames) and PRIVATE_OFFICE spaces. When present, the booking
   * also writes per-day DeskBookingRecords so the availability calendar blocks the
   * unit; a taken unit rejects the whole booking. Ignored for other categories.
   */
  deskName?: string;
}

/** Minimal price shape — satisfied by both the domain `Space` and the raw `SpaceRecord`. */
export type SpacePricing = {
  pricePerHour: number | null;
  pricePerHalfDay?: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  /** Optional CASH-booking per-unit prices; fall back to pricePer* when absent. */
  cashPricePerHour?: number | null;
  cashPricePerHalfDay?: number | null;
  cashPricePerDay?: number | null;
  cashPricePerMonth?: number | null;
};

/** Which pricing surface a space booking is priced from. */
export type SpacePriceMode = 'ONLINE_FULL' | 'CASH_DEPOSIT';

/**
 * Per-unit price for a booking. ONLINE_FULL uses the base pricePer*; a
 * CASH_DEPOSIT booking uses the optional cashPricePer* when set, falling back
 * to the base price. Returns null only when the base unit is unpriced (i.e. the
 * unit is not offered at all) — cash prices never enable a new unit on their own.
 */
export function unitPrice(
  space: SpacePricing,
  unit: BookingUnit,
  mode: SpacePriceMode = 'ONLINE_FULL',
): number | null {
  const base =
    unit === 'HOUR' ? space.pricePerHour
    : unit === 'HALF_DAY' ? (space.pricePerHalfDay ?? null)
    : unit === 'DAY' ? space.pricePerDay
    : space.pricePerMonth;
  if (base == null) return null;
  if (mode !== 'CASH_DEPOSIT') return base;
  const cash =
    unit === 'HOUR' ? space.cashPricePerHour
    : unit === 'HALF_DAY' ? space.cashPricePerHalfDay
    : unit === 'DAY' ? space.cashPricePerDay
    : space.cashPricePerMonth;
  return cash != null ? cash : base;
}

export function availableUnits(space: SpacePricing): BookingUnit[] {
  const out: BookingUnit[] = [];
  if (space.pricePerHour != null) out.push('HOUR');
  if (space.pricePerHalfDay != null) out.push('HALF_DAY');
  if (space.pricePerDay != null) out.push('DAY');
  if (space.pricePerMonth != null) out.push('MONTH');
  return out;
}

/** Derive how many billing units the [startsAt, endsAt) window covers. */
export function computeQuantity(startsAt: string, endsAt: string, unit: BookingUnit): number {
  const diffMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  switch (unit) {
    case 'HOUR':  return Math.max(1, Math.ceil(diffMs / 3_600_000));
    case 'HALF_DAY': return 1; // a half-day is one flat-priced block
    case 'DAY':   return Math.max(1, Math.ceil(diffMs / 86_400_000));
    case 'MONTH': {
      const s = new Date(startsAt);
      const e = new Date(endsAt);
      const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
      return Math.max(1, months);
    }
  }
}

/** "HH:MM" → minutes since midnight */
function timeToMinutes(t: string): number {
  const parts = t.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** Extract UTC HH:MM minutes from an ISO datetime string. */
function isoToUtcMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Extract UTC day-of-week (0=Sun…6=Sat) from an ISO datetime string. */
function isoToUtcDow(iso: string): number {
  return new Date(iso).getUTCDay();
}

/**
 * Validate a booking window against the space's working-hours config.
 * Returns null if valid, or the specific error reason.
 */
/** Minimal working-hours shape — satisfied by both `Space` and `SpaceRecord`. */
export type SpaceHours = {
  workingDays?: number[] | null;
  openingTime?: string | null;
  closingTime?: string | null;
};

export function validateWorkingHours(
  startsAt: string,
  endsAt: string,
  space: SpaceHours,
): null | 'OUTSIDE_WORKING_HOURS' | 'NOT_A_WORKING_DAY' {
  const workingDays  = space.workingDays  ?? [1, 2, 3, 4, 5];
  const openingMins  = timeToMinutes(space.openingTime ?? '09:00');
  const closingMins  = timeToMinutes(space.closingTime ?? '18:00');

  const startDow  = isoToUtcDow(startsAt);
  const endDow    = isoToUtcDow(endsAt);
  const startMins = isoToUtcMinutes(startsAt);
  const endMins   = isoToUtcMinutes(endsAt);

  // Working day check: both start and end day must be in workingDays
  if (!workingDays.includes(startDow) || !workingDays.includes(endDow)) {
    return 'NOT_A_WORKING_DAY';
  }
  // Time window check: start >= opening, end <= closing
  if (startMins < openingMins || endMins > closingMins) {
    return 'OUTSIDE_WORKING_HOURS';
  }
  return null;
}

function newWallet(userId: string): WalletRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    balance: 0,
    currency: 'DZD',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

export async function createSpaceBooking(
  args: CreateSpaceBookingArgs,
): Promise<CreateSpaceBookingResult> {
  // Look up the space outside the critical section — the catalog is
  // an in-memory read for now, so it's fine to do before the lock.
  const space = await findSpaceById(args.spaceId);
  if (!space) return { ok: false, reason: 'SPACE_NOT_FOUND' };

  // ── Booker identity ───────────────────────────────────────────────────
  // Resolved once here so the idempotency key, the desk hold and the booking
  // row all agree on who is booking. Exactly one of these is ever non-null.
  const bookerUserId   = args.booker.type === 'user'   ? args.booker.userId   : null;
  const bookerMentorId = args.booker.type === 'mentor' ? args.booker.mentorId : null;

  // Consultants have no Metwork wallet, no membership tier and no Network Pass
  // credits, so cash-on-site is the only settlement path open to them. Reject
  // anything else up front rather than letting it reach a wallet branch that
  // would have to invent an account.
  if (args.booker.type === 'mentor') {
    if (args.paymentMethod !== 'manual') return { ok: false, reason: 'CONSULTANT_CASH_ONLY' };
    if (!space.acceptedPaymentMethods?.includes('CASH')) {
      return { ok: false, reason: 'CASH_NOT_ACCEPTED' };
    }
  }

  const price = unitPrice(space, args.unit);
  if (price == null) {
    return { ok: false, reason: 'UNIT_NOT_AVAILABLE', available: availableUnits(space) };
  }

  // ── Working hours validation (outside lock — no writes) ────────────
  const whError = validateWorkingHours(args.startsAt, args.endsAt, space);
  if (whError === 'NOT_A_WORKING_DAY') {
    return { ok: false, reason: 'NOT_A_WORKING_DAY', workingDays: space.workingDays ?? [1,2,3,4,5] };
  }
  if (whError === 'OUTSIDE_WORKING_HOURS') {
    return {
      ok: false,
      reason: 'OUTSIDE_WORKING_HOURS',
      openingTime: space.openingTime ?? '09:00',
      closingTime: space.closingTime ?? '18:00',
    };
  }

  const quantity  = computeQuantity(args.startsAt, args.endsAt, args.unit);
  const { endsAt } = args;
  // Server-side duration discount (e.g. 3+ days → 10 % off), applied to the
  // computed price first. The client never supplies the percentage.
  const durationPercent = bestDurationDiscountPercent(space.durationDiscounts, args.unit, quantity);
  const afterDuration   = applyDiscountPercent(price * quantity, durationPercent);
  // Apply membership discount (e.g. STARTUP tier 20 % off) before promo codes
  const membershipFraction = Math.min(1, Math.max(0, args.membershipDiscount ?? 0));
  const baseTotal = membershipFraction > 0
    ? Math.round(afterDuration * (1 - membershipFraction))
    : afterDuration;

  // Ensure promo codes are seeded before entering the critical section.
  if (args.promoCode) await ensurePromoCodesSeeded();

  const isCash = args.paymentMethod === 'manual';
  const isNetworkPass = args.paymentMethod === 'NETWORK_PASS';

  // Pre-check: blackouts + capacity-aware occupancy (outside the DB lock for a
  // fast reject; the binding re-check runs inside the lock below).
  {
    const snap = await db.read();
    const rawSpace = snap.spaces?.find((s) => s.id === args.spaceId);
    if (rawSpace) {
      const pre = checkSpaceAvailability({
        space: rawSpace,
        bookings: snap.bookings,
        spaceId: rawSpace.id,
        unit: args.unit,
        startsAt: args.startsAt,
        endsAt,
      });
      if (!pre.ok) {
        if (pre.reason === 'DATE_UNAVAILABLE') return { ok: false, reason: 'DATE_UNAVAILABLE', blockedDates: pre.blockedDates };
        if (pre.reason === 'OVERLAP_CONFLICT') return { ok: false, reason: 'OVERLAP_CONFLICT', conflictingBookingId: pre.conflictingBookingId };
        return { ok: false, reason: 'CAPACITY_EXCEEDED', capacity: pre.capacity, taken: pre.taken };
      }
    }
  }

  return db.update<CreateSpaceBookingResult>((d) => {
    // Idempotency: same clientReference for the same user → return the existing
    // booking and NEVER create a second one / touch the wallet or credits again.
    // Cash (`manual`) and NETWORK_PASS bookings carry no stored transaction
    // (transactionId is null and their placeholder tx is ephemeral), so we must
    // NOT gate the early-return on a transaction existing — doing so let the
    // replay fall through and duplicate the booking, double-burning a network
    // credit and double-booking a cash reservation. Synthesise a placeholder tx
    // mirroring the original response shape when none was stored.
    // Matched on the FULL booker identity, not just clientReference: consultant
    // rows carry userId === null, so keying on userId alone would put every
    // consultant (and every offline booking) in one shared `null` bucket where
    // two different consultants could replay onto each other's booking.
    const existing = d.bookings.find(
      (b) =>
        (b.userId ?? null) === bookerUserId &&
        (b.mentorId ?? null) === bookerMentorId &&
        b.clientReference === args.clientReference,
    );
    if (existing) {
      // Consultants own no wallet row — hand back an ephemeral zero wallet so
      // the result shape holds without materialising a user wallet for them.
      const w = bookerUserId
        ? d.wallets.find((x) => x.userId === bookerUserId) ?? newWallet(bookerUserId)
        : newWallet('');
      const storedTx = existing.transactionId
        ? d.transactions.find((t) => t.id === existing.transactionId) ?? null
        : null;
      const tx: TransactionRecord = storedTx ?? {
        id: randomUUID(),
        walletId: w.id,
        userId: bookerUserId ?? '',
        type: 'PAYMENT',
        amount: 0,
        balanceAfter: w.balance,
        status: existing.paymentMethod === 'manual' ? 'PENDING' : 'COMPLETED',
        description: `Booking — ${existing.itemName}`,
        reference: args.clientReference,
        provider:
          existing.paymentMethod === 'NETWORK_PASS' ? 'network_pass'
          : existing.paymentMethod === 'manual' ? 'cash'
          : 'internal',
        providerTxnId: null,
        metadata: { bookingItemKind: 'SPACE', bookingItemId: existing.itemId, replayed: true },
        createdAt: existing.createdAt,
        completedAt: existing.paymentMethod === 'manual' ? null : existing.createdAt,
      };
      return { ok: true, replayed: true, booking: existing, transaction: tx, wallet: w };
    }

    // ── Shared availability gate: blackouts + capacity-aware occupancy ──
    // Authoritative re-check inside the lock (state may have changed since the
    // pre-check). Same function every booking path calls so rules never diverge.
    const spaceRec = d.spaces?.find((s) => s.id === space.id);
    if (spaceRec) {
      const avail = checkSpaceAvailability({
        space: spaceRec,
        bookings: d.bookings,
        spaceId: space.id,
        unit: args.unit,
        startsAt: args.startsAt,
        endsAt,
      });
      if (!avail.ok) {
        if (avail.reason === 'DATE_UNAVAILABLE') return { ok: false, reason: 'DATE_UNAVAILABLE', blockedDates: avail.blockedDates };
        if (avail.reason === 'OVERLAP_CONFLICT') return { ok: false, reason: 'OVERLAP_CONFLICT', conflictingBookingId: avail.conflictingBookingId };
        return { ok: false, reason: 'CAPACITY_EXCEEDED', capacity: avail.capacity, taken: avail.taken };
      }
    }

    // ── Category-specific desk / office hold (COWORKING + PRIVATE_OFFICE) ──
    // Pre-mint the booking id so every success branch shares one identity and the
    // desk holds link back for cancellation. We pre-CHECK availability here (pure,
    // no write) so a taken unit rejects BEFORE any wallet/credit mutation, then
    // COMMIT the per-day holds inside each branch right before the booking push
    // (single-threaded closure → the early check still holds). Same canonical
    // writer the manual route uses, so the two surfaces can never diverge.
    const bookingId = randomUUID();
    const deskName = args.deskName?.trim();
    const deskCategory = spaceRec?.category;
    const needsDesk = !!deskName && (deskCategory === 'COWORKING' || deskCategory === 'PRIVATE_OFFICE');
    if (needsDesk && spaceRec) {
      if (deskCategory === 'COWORKING' && !(spaceRec.deskNames ?? []).includes(deskName!)) {
        return { ok: false, reason: 'OVERLAP_CONFLICT', conflictingBookingId: '' };
      }
      const taken = eachDayInRange(args.startsAt, endsAt).find(
        (day) => !isDeskFreeInRange(d.deskBookings ?? [], spaceRec.id, deskName!, day, day),
      );
      if (taken) return { ok: false, reason: 'OVERLAP_CONFLICT', conflictingBookingId: '' };
    }
    const commitDeskHold = () => {
      if (!needsDesk || !spaceRec) return;
      if (!Array.isArray(d.deskBookings)) d.deskBookings = [];
      holdDeskForBooking(d.deskBookings, {
        spaceId: spaceRec.id,
        incubatorId: spaceRec.incubatorId,
        deskName: deskName!,
        startsAt: args.startsAt,
        endsAt,
        userId: bookerUserId,
        clientName:
          args.booker.type === 'mentor'
            ? args.booker.contact.fullName
            : d.users.find((u) => u.id === bookerUserId)?.fullName ?? null,
        clientPhone: args.booker.type === 'mentor' ? args.booker.contact.phone : null,
        bookingId,
        source: 'online',
      });
    };

    // Apply promo code discount (only for online payment)
    let total = baseTotal;
    let promoCodeId: string | null = null;
    if (!isCash && args.promoCode && args.promoCode.trim()) {
      const promo = validatePromoCode(d.promoCodes ?? [], args.promoCode, baseTotal, 'SPACE');
      if (promo.valid) {
        total       = promo.finalAmount;
        promoCodeId = promo.promoCodeId;
      }
    }

    // ── Consultant path: CASH reservation, no money movement ────────────
    // Runs BEFORE any wallet work: a consultant has no wallet row and must
    // never cause one to be created. The seat is held exactly like a platform
    // user's cash booking (same availability gate, same desk hold, same
    // PENDING_PAYMENT status) — the space collects payment on site.
    if (args.booker.type === 'mentor') {
      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: bookingId,
        userId: null,
        mentorId: args.booker.mentorId,
        source: 'online',
        clientName: args.booker.contact.fullName,
        clientEmail: args.booker.contact.email,
        clientPhone: args.booker.contact.phone,
        itemKind: 'SPACE',
        itemId: space.id,
        itemName: space.name,
        vendorName: space.incubatorName,
        city: space.city,
        unit: args.unit,
        quantity,
        startsAt: args.startsAt,
        endsAt,
        totalAmount: baseTotal,
        status: 'PENDING_PAYMENT',
        clientReference: args.clientReference,
        transactionId: null,
        paymentMethod: 'manual',
        createdAt: now,
        updatedAt: now,
      };
      commitDeskHold();
      d.bookings.push(booking);
      // Ephemeral, unpersisted placeholder so the shared result shape holds.
      // Nothing here touches `d.wallets` or `d.transactions`.
      const ghost = newWallet('');
      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: ghost.id,
        userId: '',
        type: 'PAYMENT',
        amount: 0,
        balanceAfter: 0,
        status: 'PENDING',
        description: `Consultant reservation — ${space.name}`,
        reference: args.clientReference,
        provider: 'cash',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'SPACE',
          bookingItemId: space.id,
          mentorId: args.booker.mentorId,
        },
        createdAt: now,
        completedAt: null,
      };
      return { ok: true, replayed: false, booking, transaction: tx, wallet: ghost };
    }

    // Everything below is the platform-user path (wallet, membership discounts,
    // Network Pass). `args.booker` narrows to `{ type: 'user' }` here because
    // the mentor actor returned above.
    const userId = args.booker.userId;

    // Wallet — auto-create on first access.
    let wallet = d.wallets.find((w) => w.userId === userId);
    if (!wallet) {
      wallet = newWallet(userId);
      d.wallets.push(wallet);
    }

    // ── Network Pass path: redeem a monthly credit, no wallet charge ───
    if (isNetworkPass) {
      // Feature gate, checked before anything else in this branch: the UI hides
      // the option, but a hand-rolled request must not be able to burn a credit
      // and create a free confirmed booking while the feature is off.
      if (!isNetworkPassEnabled()) {
        return { ok: false, reason: 'NETWORK_PASS_DISABLED' };
      }
      if (!spaceRec?.isPartnerInNetwork) {
        return { ok: false, reason: 'NOT_PARTNER_SPACE' };
      }

      const user = d.users.find((u) => u.id === userId);
      if (!user) {
        // Shouldn't happen — guard already gated on a valid session — but
        // returning a 'TIER_NOT_ELIGIBLE' makes the failure mode explicit.
        return { ok: false, reason: 'TIER_NOT_ELIGIBLE', tier: 'EXPLORER' };
      }
      const tier = user.membershipTier ?? 'EXPLORER';
      if (tier === 'EXPLORER') {
        return { ok: false, reason: 'TIER_NOT_ELIGIBLE', tier: 'EXPLORER' };
      }
      // A plan can grant zero passes (Builder does). Those members are not
      // eligible at all — reporting NO_CREDITS would wrongly suggest they had
      // an allowance and merely spent it.
      if (resolveMemberBenefits(d, user).monthlyPassCount <= 0) {
        return { ok: false, reason: 'TIER_NOT_ELIGIBLE', tier };
      }
      const currentCredits = user.networkCredits ?? 0;
      if (currentCredits <= 0) {
        return { ok: false, reason: 'NO_CREDITS', creditsRemaining: currentCredits };
      }

      const now = new Date().toISOString();

      // Atomic credit decrement + counters
      user.networkCredits = currentCredits - 1;
      user.networkPassesUsedThisMonth = (user.networkPassesUsedThisMonth ?? 0) + 1;
      user.lastNetworkVisit = now;
      // Track unique partner spaces visited (used for fraud signals).
      const visited = new Set(user.networkSpacesVisited ?? []);
      visited.add(space.id);
      user.networkSpacesVisited = Array.from(visited);
      user.updatedAt = now;

      // Free booking — CONFIRMED immediately, no wallet movement.
      const booking: BookingRecord = {
        id: bookingId,
        userId: userId,
        itemKind: 'SPACE',
        itemId: space.id,
        itemName: space.name,
        vendorName: space.incubatorName,
        city: space.city,
        unit: args.unit,
        quantity,
        startsAt: args.startsAt,
        endsAt,
        totalAmount: 0,
        status: 'CONFIRMED',
        clientReference: args.clientReference,
        transactionId: null,
        paymentMethod: 'NETWORK_PASS',
        createdAt: now,
        updatedAt: now,
      };
      commitDeskHold();
      d.bookings.push(booking);

      // Record the per-visit ledger entry that drives the monthly partner
      // payout batch. payoutAmount comes from the partner enrolment record;
      // fallback to 300 DZD if the rate isn't configured.
      const partner = (d.partnerMemberships ?? []).find(
        (p) => p.id === spaceRec.partnerMembershipId,
      );
      const payoutAmount = partner?.networkPayoutRate ?? 300;
      if (!Array.isArray(d.networkVisits)) d.networkVisits = [];
      const visit = {
        id: randomUUID(),
        userId: userId,
        spaceId: space.id,
        bookingId: booking.id,
        checkedInAt: null,
        checkedInBy: null,
        checkedInMethod: null,
        payoutStatus: 'PENDING' as const,
        payoutAmount,
        payoutBatchId: null,
        paidOutDate: null,
        createdAt: now,
        updatedAt: now,
      };
      d.networkVisits.push(visit);
      booking.networkVisitId = visit.id;

      // Zero-amount placeholder transaction so callers (which expect a tx in
      // the success branch) don't break. Matches the cash path's pattern.
      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: userId,
        type: 'PAYMENT',
        amount: 0,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Network Pass — ${space.name}`,
        reference: args.clientReference,
        provider: 'network_pass',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'SPACE',
          bookingItemId: space.id,
          networkVisitId: visit.id,
        },
        createdAt: now,
        completedAt: now,
      };

      return { ok: true, replayed: false, booking, transaction: tx, wallet };
    }

    // ── Cash path: reserve without charging ────────────────────────────
    if (isCash) {
      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: bookingId,
        userId: userId,
        itemKind: 'SPACE',
        itemId: space.id,
        itemName: space.name,
        vendorName: space.incubatorName,
        city: space.city,
        unit: args.unit,
        quantity,
        startsAt: args.startsAt,
        endsAt,
        totalAmount: baseTotal,
        status: 'PENDING_PAYMENT',
        clientReference: args.clientReference,
        transactionId: null,
        paymentMethod: 'manual',
        createdAt: now,
        updatedAt: now,
      };
      commitDeskHold();
      d.bookings.push(booking);
      // Return a placeholder zero transaction so the route shape stays consistent.
      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: userId,
        type: 'PAYMENT',
        amount: 0,
        balanceAfter: wallet.balance,
        status: 'PENDING',
        description: `Cash reservation — ${space.name}`,
        reference: args.clientReference,
        provider: 'cash',
        providerTxnId: null,
        metadata: { bookingItemKind: 'SPACE', bookingItemId: space.id },
        createdAt: now,
        completedAt: null,
      };
      return { ok: true, replayed: false, booking, transaction: tx, wallet };
    }

    // ── REQUEST mode (approve-then-pay): reserve without charging ───────
    // The space is configured "Request to Book": create the booking as
    // AWAITING_APPROVAL with NO wallet debit and NO incubator credit. The
    // seat is soft-held (bookingHoldsSeat) so overlap detection can never
    // approve two users for the same slot. Money moves only later, in
    // POST /api/bookings/[id]/pay, after the incubator approves.
    if (spaceRec?.reservationMode === 'REQUEST') {
      const now = new Date().toISOString();
      // Freeze the promo-discounted total now (and burn the use) so the
      // amount the client is asked to pay after approval can never drift.
      if (promoCodeId) consumePromoCode(d.promoCodes ?? [], promoCodeId);
      const booking: BookingRecord = {
        id: bookingId,
        userId: userId,
        itemKind: 'SPACE',
        itemId: space.id,
        itemName: space.name,
        vendorName: space.incubatorName,
        city: space.city,
        unit: args.unit,
        quantity,
        startsAt: args.startsAt,
        endsAt,
        totalAmount: total,
        status: 'AWAITING_APPROVAL',
        reservationMode: 'REQUEST',
        clientReference: args.clientReference,
        transactionId: null,
        paymentMethod: 'wallet',
        createdAt: now,
        updatedAt: now,
      };
      commitDeskHold();
      d.bookings.push(booking);
      // Placeholder zero transaction (not stored) so the route shape stays
      // consistent — mirrors the cash path.
      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: userId,
        type: 'PAYMENT',
        amount: 0,
        balanceAfter: wallet.balance,
        status: 'PENDING',
        description: `Booking request — ${space.name}`,
        reference: args.clientReference,
        provider: 'internal',
        providerTxnId: null,
        metadata: { bookingItemKind: 'SPACE', bookingItemId: space.id, reservationMode: 'REQUEST' },
        createdAt: now,
        completedAt: null,
      };
      return { ok: true, replayed: false, booking, transaction: tx, wallet };
    }

    // ── Online path ─────────────────────────────────────────────────────
    if (wallet.status === 'FROZEN') {
      return { ok: false, reason: 'WALLET_FROZEN' };
    }
    if (total > 0 && wallet.balance < total) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: total,
      };
    }

    const now = new Date().toISOString();

    // Consume promo code use count
    if (promoCodeId) consumePromoCode(d.promoCodes ?? [], promoCodeId);

    // Atomic: deduct wallet (only when total > 0) → write transaction → write booking.
    let tx: TransactionRecord;
    if (total > 0) {
      wallet.balance -= total;
      wallet.updatedAt = now;
      tx = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: userId,
        type: 'PAYMENT',
        amount: -total,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Booking — ${space.name}`,
        reference: args.clientReference,
        provider: 'internal',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'SPACE',
          bookingItemId: space.id,
          unit: args.unit,
          quantity,
          promoCode: args.promoCode ?? null,
          originalAmount: baseTotal,
        },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);
    } else {
      // Free booking (promo made it 0) — create a zero-amount placeholder transaction
      tx = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: userId,
        type: 'PAYMENT',
        amount: 0,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Booking — ${space.name} (promo applied)`,
        reference: args.clientReference,
        provider: 'internal',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'SPACE',
          bookingItemId: space.id,
          unit: args.unit,
          quantity,
          promoCode: args.promoCode ?? null,
          originalAmount: baseTotal,
        },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);
    }

    const booking: BookingRecord = {
      id: bookingId,
      userId: userId,
      itemKind: 'SPACE',
      itemId: space.id,
      itemName: space.name,
      vendorName: space.incubatorName,
      city: space.city,
      unit: args.unit,
      quantity,
      startsAt: args.startsAt,
      endsAt,
      totalAmount: total,
      status: 'PENDING',
      clientReference: args.clientReference,
      transactionId: tx.id,
      paymentMethod: 'wallet',
      createdAt: now,
      updatedAt: now,
    };
    commitDeskHold();
    d.bookings.push(booking);

    // ── INSTANT mode: auto-confirm + credit the incubator, same critical
    // section as the debit above so the two movements can never disagree.
    // Same accounting as the manual-approve path (full amount, PAYOUT tx,
    // reference `payout-${booking.id}`), just without the approval step.
    // If the incubator/manager can't be resolved, the booking stays on the
    // legacy PENDING escrow so the manual approval flow settles it.
    if (spaceRec?.reservationMode === 'INSTANT') {
      const incubator = d.incubators.find((i) => i.id === spaceRec.incubatorId);
      if (incubator?.managerId) {
        booking.status = 'CONFIRMED';
        booking.reservationMode = 'INSTANT';
        booking.paidAt = now;
        if (total > 0) {
          let incubatorWallet = d.wallets.find((w) => w.userId === incubator.managerId);
          if (!incubatorWallet) {
            incubatorWallet = newWallet(incubator.managerId);
            d.wallets.push(incubatorWallet);
          }
          if (incubatorWallet.status !== 'FROZEN') {
            incubatorWallet.balance += total;
            incubatorWallet.updatedAt = now;
            d.transactions.push({
              id: randomUUID(),
              walletId: incubatorWallet.id,
              userId: incubator.managerId,
              type: 'PAYOUT',
              amount: total,
              balanceAfter: incubatorWallet.balance,
              status: 'COMPLETED',
              description: `Booking revenue — ${booking.itemName}`,
              reference: `payout-${booking.id}`,
              provider: 'internal',
              providerTxnId: null,
              metadata: { bookingId: booking.id, customerId: booking.userId, reservationMode: 'INSTANT' },
              createdAt: now,
              completedAt: now,
            });
          }
        }
      }
    }

    return { ok: true, replayed: false, booking, transaction: tx, wallet };
  });
}

export async function listBookingsForUser(userId: string) {
  const data = await db.read();
  return data.bookings
    .filter((b) => b.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ─────────────────────────── Programs ─────────────────────────── */

export interface ApplyToProgramArgs {
  userId: string;
  programId: string;
  clientReference: string;
  promoCode?: string;
  paymentMethod?: 'wallet' | 'manual';
}

/**
 * Apply to a program. The wallet debit (when the program isn't free),
 * the deadline / capacity / dedup checks, and the booking insert all
 * happen inside one `db.update` critical section.
 *
 * Idempotent on `clientReference` AND deduped on (userId, programId):
 * a user can only have one active application per program.
 */
export async function applyToProgram(args: ApplyToProgramArgs): Promise<ApplyToProgramResult> {
  const program = await findProgramById(args.programId);
  if (!program) return { ok: false, reason: 'PROGRAM_NOT_FOUND' };

  // Consultant-owned programs do not settle through this path: it credits the
  // owning INCUBATOR's wallet, and consultants have none (their earnings live
  // in the parallel mentorId-keyed ledger). Fail closed — a paid application
  // here would take the applicant's money and settle it to nobody. Free
  // consultant programs use the no-payment registration flow instead
  // (`POST /api/registrations`), which is owner-agnostic by design.
  if (program.mentorId) return { ok: false, reason: 'PROGRAM_NOT_FOUND' };

  // Deadline check (outside the lock — read-only).
  if (Date.parse(program.deadline) <= Date.now()) {
    return { ok: false, reason: 'DEADLINE_PASSED', deadline: program.deadline };
  }

  if (args.promoCode) await ensurePromoCodesSeeded();

  const isCash = args.paymentMethod === 'manual';

  return db.update<ApplyToProgramResult>((d) => {
    // Replay (same clientReference) → return the existing booking.
    const replay = d.bookings.find(
      (b) => b.userId === args.userId && b.clientReference === args.clientReference,
    );
    if (replay) {
      const tx = replay.transactionId
        ? d.transactions.find((t) => t.id === replay.transactionId) ?? null
        : null;
      const w = d.wallets.find((x) => x.userId === args.userId) ?? newWallet(args.userId);
      return { ok: true, replayed: true, booking: replay, transaction: tx, wallet: w };
    }

    // Already-applied dedup (active = not cancelled/refunded).
    const active = d.bookings.find(
      (b) =>
        b.userId === args.userId &&
        b.itemKind === 'PROGRAM' &&
        b.itemId === program.id &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    );
    if (active) return { ok: false, reason: 'ALREADY_APPLIED', existingBookingId: active.id };

    // Capacity — unified count (active bookings + confirmed registrations),
    // NOT the cached `seatsTaken`.
    const taken = countAttendance(d, 'PROGRAM', program.id);
    if (taken >= program.seatsTotal) {
      return { ok: false, reason: 'CAPACITY_EXCEEDED', capacity: program.seatsTotal, taken };
    }

    const baseTotal = program.price;
    let wallet = d.wallets.find((w) => w.userId === args.userId);
    if (!wallet) {
      wallet = newWallet(args.userId);
      d.wallets.push(wallet);
    }

    // ── Cash path ──────────────────────────────────────────────────────
    if (isCash && baseTotal > 0) {
      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: randomUUID(),
        userId: args.userId,
        itemKind: 'PROGRAM',
        itemId: program.id,
        itemName: program.title,
        vendorName: program.incubatorName,
        city: program.city,
        unit: 'DAY',
        quantity: 1,
        startsAt: program.startDate,
        endsAt: program.endDate,
        totalAmount: baseTotal,
        status: 'PENDING_PAYMENT',
        clientReference: args.clientReference,
        transactionId: null,
        paymentMethod: 'manual',
        createdAt: now,
        updatedAt: now,
      };
      d.bookings.push(booking);
      return { ok: true, replayed: false, booking, transaction: null, wallet };
    }

    // ── Online path ─────────────────────────────────────────────────────
    // Apply promo code discount
    let total = baseTotal;
    let promoCodeId: string | null = null;
    if (args.promoCode && args.promoCode.trim() && baseTotal > 0) {
      const promo = validatePromoCode(d.promoCodes ?? [], args.promoCode, baseTotal, 'PROGRAM');
      if (promo.valid) {
        total       = promo.finalAmount;
        promoCodeId = promo.promoCodeId;
      }
    }

    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

    if (total > 0 && wallet.balance < total) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: total,
      };
    }

    const now = new Date().toISOString();

    // Consume promo code use count
    if (promoCodeId) consumePromoCode(d.promoCodes ?? [], promoCodeId);

    // Wallet debit only when there's a fee. Free (or fully discounted) programs skip the ledger.
    let tx: TransactionRecord | null = null;
    if (total > 0) {
      wallet.balance -= total;
      wallet.updatedAt = now;
      tx = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: args.userId,
        type: 'PAYMENT',
        amount: -total,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Program — ${program.title}`,
        reference: args.clientReference,
        provider: 'internal',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'PROGRAM',
          bookingItemId: program.id,
          promoCode: args.promoCode ?? null,
          originalAmount: baseTotal,
        },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);
    }

    const booking: BookingRecord = {
      id: randomUUID(),
      userId: args.userId,
      itemKind: 'PROGRAM',
      itemId: program.id,
      itemName: program.title,
      vendorName: program.incubatorName,
      city: program.city,
      unit: 'DAY', // program duration is fixed; unit is purely informational here
      quantity: 1,
      startsAt: program.startDate,
      endsAt: program.endDate,
      totalAmount: total,
      status: 'PENDING',
      clientReference: args.clientReference,
      transactionId: tx?.id ?? null,
      paymentMethod: 'wallet',
      createdAt: now,
      updatedAt: now,
    };
    d.bookings.push(booking);

    return { ok: true, replayed: false, booking, transaction: tx, wallet };
  });
}

/** Public attendance count + my-status, used by the detail sheet. */
export async function getProgramAttendance(programId: string, userId?: string) {
  const data = await db.read();
  // Unified seat count (active bookings + confirmed registrations).
  const taken = countAttendance(data, 'PROGRAM', programId);
  // `mine` stays booking-specific — it powers the explorer detail sheet's
  // "you've applied" chip, which only reflects the wallet booking flow.
  const mine = userId
    ? data.bookings.find(
        (b) =>
          b.itemKind === 'PROGRAM' &&
          b.itemId === programId &&
          b.userId === userId &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED',
      ) ?? null
    : null;
  return { taken, mine };
}

/* ─────────────────────────── Events ─────────────────────────── */

export interface RegisterForEventArgs {
  userId: string;
  eventId: string;
  clientReference: string;
  promoCode?: string;
  paymentMethod?: 'wallet' | 'manual';
  /** Fractional membership discount to apply before the promo code (0–1). e.g. 0.20 = 20 % off. */
  membershipDiscount?: number;
}

export async function registerForEvent(
  args: RegisterForEventArgs,
): Promise<RegisterForEventResult> {
  const event = await findEventById(args.eventId);
  if (!event) return { ok: false, reason: 'EVENT_NOT_FOUND' };

  if (Date.parse(event.eventDate) <= Date.now()) {
    return { ok: false, reason: 'EVENT_PASSED', eventDate: event.eventDate };
  }

  if (args.promoCode) await ensurePromoCodesSeeded();

  const isCash = args.paymentMethod === 'manual';

  return db.update<RegisterForEventResult>((d) => {
    const replay = d.bookings.find(
      (b) => b.userId === args.userId && b.clientReference === args.clientReference,
    );
    if (replay) {
      const tx = replay.transactionId
        ? d.transactions.find((t) => t.id === replay.transactionId) ?? null
        : null;
      const w = d.wallets.find((x) => x.userId === args.userId) ?? newWallet(args.userId);
      return { ok: true, replayed: true, booking: replay, transaction: tx, wallet: w };
    }

    const active = d.bookings.find(
      (b) =>
        b.userId === args.userId &&
        b.itemKind === 'EVENT' &&
        b.itemId === event.id &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    );
    if (active) {
      return { ok: false, reason: 'ALREADY_REGISTERED', existingBookingId: active.id };
    }

    // Capacity — unified count (active bookings + confirmed registrations).
    const taken = countAttendance(d, 'EVENT', event.id);
    if (taken >= event.capacity) {
      return { ok: false, reason: 'CAPACITY_EXCEEDED', capacity: event.capacity, taken };
    }

    // Apply tier membership discount to the base ticket price (server-side
    // mirror of the booking-form's preview). Builder = 15 %, Founder = 20 %.
    const membershipFraction = Math.min(1, Math.max(0, args.membershipDiscount ?? 0));
    const baseTotal =
      membershipFraction > 0 && event.price > 0
        ? Math.round(event.price * (1 - membershipFraction))
        : event.price;
    let wallet = d.wallets.find((w) => w.userId === args.userId);
    if (!wallet) {
      wallet = newWallet(args.userId);
      d.wallets.push(wallet);
    }

    // ── Cash path ──────────────────────────────────────────────────────
    if (isCash && baseTotal > 0) {
      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: randomUUID(),
        userId: args.userId,
        itemKind: 'EVENT',
        itemId: event.id,
        itemName: event.title,
        vendorName: event.incubatorName,
        city: event.city,
        unit: 'HOUR',
        quantity: 1,
        startsAt: event.eventDate,
        endsAt: event.eventDate,
        totalAmount: baseTotal,
        status: 'PENDING_PAYMENT',
        clientReference: args.clientReference,
        transactionId: null,
        paymentMethod: 'manual',
        createdAt: now,
        updatedAt: now,
      };
      d.bookings.push(booking);
      return { ok: true, replayed: false, booking, transaction: null, wallet };
    }

    // ── Online path ─────────────────────────────────────────────────────
    // Apply promo code discount
    let total = baseTotal;
    let promoCodeId: string | null = null;
    if (args.promoCode && args.promoCode.trim() && baseTotal > 0) {
      const promo = validatePromoCode(d.promoCodes ?? [], args.promoCode, baseTotal, 'EVENT');
      if (promo.valid) {
        total       = promo.finalAmount;
        promoCodeId = promo.promoCodeId;
      }
    }

    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

    if (total > 0 && wallet.balance < total) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: total,
      };
    }

    const now = new Date().toISOString();

    // Consume promo code
    if (promoCodeId) consumePromoCode(d.promoCodes ?? [], promoCodeId);

    let tx: TransactionRecord | null = null;
    if (total > 0) {
      wallet.balance -= total;
      wallet.updatedAt = now;
      tx = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: args.userId,
        type: 'PAYMENT',
        amount: -total,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Event — ${event.title}`,
        reference: args.clientReference,
        provider: 'internal',
        providerTxnId: null,
        metadata: {
          bookingItemKind: 'EVENT',
          bookingItemId: event.id,
          promoCode: args.promoCode ?? null,
          originalAmount: baseTotal,
        },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);
    }

    const booking: BookingRecord = {
      id: randomUUID(),
      userId: args.userId,
      itemKind: 'EVENT',
      itemId: event.id,
      itemName: event.title,
      vendorName: event.incubatorName,
      city: event.city,
      unit: 'HOUR',
      quantity: 1,
      startsAt: event.eventDate,
      endsAt: event.eventDate,
      totalAmount: total,
      status: 'PENDING',
      clientReference: args.clientReference,
      transactionId: tx?.id ?? null,
      paymentMethod: 'wallet',
      createdAt: now,
      updatedAt: now,
    };
    d.bookings.push(booking);

    return { ok: true, replayed: false, booking, transaction: tx, wallet };
  });
}

export async function getEventAttendance(eventId: string, userId?: string) {
  const data = await db.read();
  // Unified seat count (active bookings + confirmed registrations).
  const taken = countAttendance(data, 'EVENT', eventId);
  // `mine` stays booking-specific (explorer detail sheet "you're registered").
  const mine = userId
    ? data.bookings.find(
        (b) =>
          b.itemKind === 'EVENT' &&
          b.itemId === eventId &&
          b.userId === userId &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED',
      ) ?? null
    : null;
  return { taken, mine };
}
