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
  quantity: number;
  startsAt: string;
  clientReference: string;
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

function computeEndsAt(startsAt: string, unit: BookingUnit, quantity: number): string {
  const start = new Date(startsAt);
  const end = new Date(start);
  switch (unit) {
    case 'HOUR':
      end.setUTCHours(end.getUTCHours() + quantity);
      break;
    case 'DAY':
      end.setUTCDate(end.getUTCDate() + quantity);
      break;
    case 'MONTH':
      end.setUTCMonth(end.getUTCMonth() + quantity);
      break;
  }
  return end.toISOString();
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
  const total = price * args.quantity;
  const endsAt = computeEndsAt(args.startsAt, args.unit, args.quantity);

  return db.update<CreateSpaceBookingResult>((d) => {
    // Idempotency: same clientReference for the same user → return existing.
    const existing = d.bookings.find(
      (b) => b.userId === args.userId && b.clientReference === args.clientReference,
    );
    if (existing) {
      const tx = d.transactions.find((t) => t.id === existing.transactionId);
      const w = d.wallets.find((x) => x.userId === args.userId);
      if (tx && w) {
        return { ok: true, replayed: true, booking: existing, transaction: tx, wallet: w };
      }
    }

    // Wallet — auto-create on first access.
    let wallet = d.wallets.find((w) => w.userId === args.userId);
    if (!wallet) {
      wallet = newWallet(args.userId);
      d.wallets.push(wallet);
    }
    if (wallet.status === 'FROZEN') {
      return { ok: false, reason: 'WALLET_FROZEN' };
    }
    if (wallet.balance < total) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: total,
      };
    }

    // Atomic: deduct → write transaction → write booking.
    const now = new Date().toISOString();
    wallet.balance -= total;
    wallet.updatedAt = now;

    const tx: TransactionRecord = {
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
        quantity: args.quantity,
      },
      createdAt: now,
      completedAt: now,
    };
    d.transactions.push(tx);

    const booking: BookingRecord = {
      id: randomUUID(),
      userId: args.userId,
      itemKind: 'SPACE',
      itemId: space.id,
      itemName: space.name,
      vendorName: space.incubatorName,
      city: space.city,
      unit: args.unit,
      quantity: args.quantity,
      startsAt: args.startsAt,
      endsAt,
      totalAmount: total,
      status: 'CONFIRMED',
      clientReference: args.clientReference,
      transactionId: tx.id,
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

  return db.update<ApplyToProgramResult>((d) => {
    // Replay (same clientReference) → return the existing booking.
    const replay = d.bookings.find(
      (b) => b.userId === args.userId && b.clientReference === args.clientReference,
    );
    if (replay) {
      const tx = replay.transactionId
        ? d.transactions.find((t) => t.id === replay.transactionId) ?? null
        : null;
      const w = d.wallets.find((x) => x.userId === args.userId);
      if (w) return { ok: true, replayed: true, booking: replay, transaction: tx, wallet: w };
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

    // Wallet — auto-create on first access.
    let wallet = d.wallets.find((w) => w.userId === args.userId);
    if (!wallet) {
      wallet = newWallet(args.userId);
      d.wallets.push(wallet);
    }
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

    const total = program.price;
    if (total > 0 && wallet.balance < total) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: total,
      };
    }

    const now = new Date().toISOString();

    // Wallet debit only when there's a fee. Free programs skip the
    // ledger entirely so a 0-DZD row doesn't pollute the history.
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
        metadata: { bookingItemKind: 'PROGRAM', bookingItemId: program.id },
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
}

export async function registerForEvent(
  args: RegisterForEventArgs,
): Promise<RegisterForEventResult> {
  const event = await findEventById(args.eventId);
  if (!event) return { ok: false, reason: 'EVENT_NOT_FOUND' };

  if (Date.parse(event.eventDate) <= Date.now()) {
    return { ok: false, reason: 'EVENT_PASSED', eventDate: event.eventDate };
  }

  return db.update<RegisterForEventResult>((d) => {
    const replay = d.bookings.find(
      (b) => b.userId === args.userId && b.clientReference === args.clientReference,
    );
    if (replay) {
      const tx = replay.transactionId
        ? d.transactions.find((t) => t.id === replay.transactionId) ?? null
        : null;
      const w = d.wallets.find((x) => x.userId === args.userId);
      if (w) return { ok: true, replayed: true, booking: replay, transaction: tx, wallet: w };
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

    let wallet = d.wallets.find((w) => w.userId === args.userId);
    if (!wallet) {
      wallet = newWallet(args.userId);
      d.wallets.push(wallet);
    }
    if (wallet.status === 'FROZEN') return { ok: false, reason: 'WALLET_FROZEN' };

    const total = event.price;
    if (total > 0 && wallet.balance < total) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_FUNDS',
        balance: wallet.balance,
        required: total,
      };
    }

    const now = new Date().toISOString();
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
        metadata: { bookingItemKind: 'EVENT', bookingItemId: event.id },
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
