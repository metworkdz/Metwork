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
import { findProgramById } from './program-catalog';
import { findEventById } from './event-catalog';
import { validatePromoCode, consumePromoCode, ensurePromoCodesSeeded } from '@/server/promo-codes/service';
import type {
  ApplyToProgramResult,
  CreateSpaceBookingResult,
  RegisterForEventResult,
} from './types';
import type { Space } from '@/types/domain';

export interface CreateSpaceBookingArgs {
  userId: string;
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  clientReference: string;
  promoCode?: string;
  /** Default 'ONLINE'. CASH = reserve only, no wallet debit, status PENDING_PAYMENT. */
  paymentMethod?: 'ONLINE' | 'CASH';
}

function unitPrice(space: Space, unit: BookingUnit): number | null {
  switch (unit) {
    case 'HOUR': return space.pricePerHour;
    case 'DAY': return space.pricePerDay;
    case 'MONTH': return space.pricePerMonth;
  }
}

function availableUnits(space: Space): BookingUnit[] {
  const out: BookingUnit[] = [];
  if (space.pricePerHour != null) out.push('HOUR');
  if (space.pricePerDay != null) out.push('DAY');
  if (space.pricePerMonth != null) out.push('MONTH');
  return out;
}

/** Derive how many billing units the [startsAt, endsAt) window covers. */
function computeQuantity(startsAt: string, endsAt: string, unit: BookingUnit): number {
  const diffMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  switch (unit) {
    case 'HOUR':  return Math.max(1, Math.ceil(diffMs / 3_600_000));
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
function validateWorkingHours(
  startsAt: string,
  endsAt: string,
  space: Space,
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
  const baseTotal = price * quantity;

  // Ensure promo codes are seeded before entering the critical section.
  if (args.promoCode) await ensurePromoCodesSeeded();

  const isCash = args.paymentMethod === 'CASH';

  return db.update<CreateSpaceBookingResult>((d) => {
    // Idempotency: same clientReference for the same user → return existing.
    const existing = d.bookings.find(
      (b) => b.userId === args.userId && b.clientReference === args.clientReference,
    );
    if (existing) {
      const tx = existing.transactionId
        ? d.transactions.find((t) => t.id === existing.transactionId) ?? null
        : null;
      const w = d.wallets.find((x) => x.userId === args.userId) ?? newWallet(args.userId);
      if (tx) return { ok: true, replayed: true, booking: existing, transaction: tx, wallet: w };
    }

    // ── Overlap check: reject if an active booking occupies part of the window ──
    const newStart = new Date(args.startsAt).getTime();
    const newEnd   = new Date(args.endsAt).getTime();
    const conflict = d.bookings.find((b) => {
      if (b.itemKind !== 'SPACE' || b.itemId !== space.id) return false;
      if (b.status === 'CANCELLED' || b.status === 'REFUNDED') return false;
      const bStart = new Date(b.startsAt).getTime();
      const bEnd   = new Date(b.endsAt).getTime();
      // Overlap when: newStart < bEnd && newEnd > bStart
      return newStart < bEnd && newEnd > bStart;
    });
    if (conflict) {
      return { ok: false, reason: 'OVERLAP_CONFLICT', conflictingBookingId: conflict.id };
    }

    // Apply promo code discount (only for online payment)
    let total = baseTotal;
    let promoCodeId: string | null = null;
    if (!isCash && args.promoCode && args.promoCode.trim()) {
      const promo = validatePromoCode(d.promoCodes ?? [], args.promoCode, baseTotal);
      if (promo.valid) {
        total       = promo.finalAmount;
        promoCodeId = promo.promoCodeId;
      }
    }

    // Wallet — auto-create on first access.
    let wallet = d.wallets.find((w) => w.userId === args.userId);
    if (!wallet) {
      wallet = newWallet(args.userId);
      d.wallets.push(wallet);
    }

    // ── Cash path: reserve without charging ────────────────────────────
    if (isCash) {
      const now = new Date().toISOString();
      const booking: BookingRecord = {
        id: randomUUID(),
        userId: args.userId,
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
        paymentMethod: 'CASH',
        createdAt: now,
        updatedAt: now,
      };
      d.bookings.push(booking);
      // Return a placeholder zero transaction so the route shape stays consistent.
      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        userId: args.userId,
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
        userId: args.userId,
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
        userId: args.userId,
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
      id: randomUUID(),
      userId: args.userId,
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
      status: 'CONFIRMED',
      clientReference: args.clientReference,
      transactionId: tx.id,
      paymentMethod: 'ONLINE',
      createdAt: now,
      updatedAt: now,
    };
    d.bookings.push(booking);

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
  paymentMethod?: 'ONLINE' | 'CASH';
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

  // Deadline check (outside the lock — read-only).
  if (Date.parse(program.deadline) <= Date.now()) {
    return { ok: false, reason: 'DEADLINE_PASSED', deadline: program.deadline };
  }

  if (args.promoCode) await ensurePromoCodesSeeded();

  const isCash = args.paymentMethod === 'CASH';

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

    // Capacity — bookings are the source of truth, NOT the cached `seatsTaken`.
    const taken = d.bookings.filter(
      (b) =>
        b.itemKind === 'PROGRAM' &&
        b.itemId === program.id &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    ).length;
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
        paymentMethod: 'CASH',
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
      const promo = validatePromoCode(d.promoCodes ?? [], args.promoCode, baseTotal);
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
      status: 'CONFIRMED',
      clientReference: args.clientReference,
      transactionId: tx?.id ?? null,
      paymentMethod: 'ONLINE',
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
  const taken = data.bookings.filter(
    (b) =>
      b.itemKind === 'PROGRAM' &&
      b.itemId === programId &&
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED',
  ).length;
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
  paymentMethod?: 'ONLINE' | 'CASH';
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

  const isCash = args.paymentMethod === 'CASH';

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

    const taken = d.bookings.filter(
      (b) =>
        b.itemKind === 'EVENT' &&
        b.itemId === event.id &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REFUNDED',
    ).length;
    if (taken >= event.capacity) {
      return { ok: false, reason: 'CAPACITY_EXCEEDED', capacity: event.capacity, taken };
    }

    const baseTotal = event.price;
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
        paymentMethod: 'CASH',
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
      const promo = validatePromoCode(d.promoCodes ?? [], args.promoCode, baseTotal);
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
      status: 'CONFIRMED',
      clientReference: args.clientReference,
      transactionId: tx?.id ?? null,
      paymentMethod: 'ONLINE',
      createdAt: now,
      updatedAt: now,
    };
    d.bookings.push(booking);

    return { ok: true, replayed: false, booking, transaction: tx, wallet };
  });
}

export async function getEventAttendance(eventId: string, userId?: string) {
  const data = await db.read();
  const taken = data.bookings.filter(
    (b) =>
      b.itemKind === 'EVENT' &&
      b.itemId === eventId &&
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED',
  ).length;
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
