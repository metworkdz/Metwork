/**
 * Split pricing (online / cash) for PROGRAMs and EVENTs.
 *
 * A host can price the two payment surfaces differently — e.g. 22 000 DZD by
 * card, 24 000 DZD in cash. `effectiveListingPrice` has existed for a while,
 * but only the card path ever called it: `applyToProgram` and
 * `registerForEvent` read `program.price` / `event.price` directly, so a
 * wallet payer choosing ONLINE was debited the CASH price. Nothing tested it.
 *
 * These tests drive the real `db.update` critical section against the
 * in-memory store and assert the amount that actually leaves the wallet — not
 * just the booking row — so the two surfaces can never silently converge again.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { db } from '@/server/db/store';
import { applyToProgram, registerForEvent } from '@/server/bookings/service';
import {
  effectiveListingPrice,
  resolveListingPricing,
  validateSplitPricing,
} from '@/lib/listing-price';

const NOW = '2026-06-01T10:00:00.000Z';
const DEADLINE = '2030-01-01T00:00:00.000Z';
const START = '2030-02-01T00:00:00.000Z';
const END = '2030-03-01T00:00:00.000Z';

/** The scenario from the field: 22 000 by card, 24 000 in cash. */
const ONLINE_PRICE = 22_000;
const CASH_PRICE = 24_000;

interface SeedOpts {
  /** Base `price`. Defaults to the cash price, mirroring how hosts fill the form. */
  price?: number;
  onlinePrice?: number | null;
  cashPrice?: number | null;
  balance?: number;
}

async function seed(opts: SeedOpts = {}): Promise<void> {
  const price = opts.price ?? CASH_PRICE;
  await db.update((d) => {
    d.users = [];
    d.wallets = [];
    d.transactions = [];
    d.bookings = [];
    d.programs = [];
    d.events = [];
    d.registrations = [];
    d.incubators = [];
    d.promoCodes = [];

    d.incubators.push({
      id: 'inc-1',
      name: 'Test Incubator',
      status: 'ACTIVE',
      managerId: 'mgr-1',
    } as never);

    d.programs.push({
      id: 'prog-1',
      incubatorId: 'inc-1',
      incubatorName: 'Test Incubator',
      mentorId: null,
      title: 'Formation Entrepreneuriat',
      description: 'A paid training',
      type: 'TRAINING',
      city: 'Algiers',
      imageUrl: null,
      imageUrls: [],
      price,
      onlinePrice: opts.onlinePrice === undefined ? ONLINE_PRICE : opts.onlinePrice,
      cashPrice: opts.cashPrice === undefined ? CASH_PRICE : opts.cashPrice,
      seatsTotal: 20,
      seatsTaken: 0,
      deadline: DEADLINE,
      startDate: START,
      endDate: END,
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 25,
      slug: 'formation-entrepreneuriat',
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);

    d.events.push({
      id: 'evt-1',
      incubatorId: 'inc-1',
      incubatorName: 'Test Incubator',
      title: 'Demo Day',
      description: 'A paid event',
      city: 'Algiers',
      imageUrl: null,
      imageUrls: [],
      price,
      onlinePrice: opts.onlinePrice === undefined ? ONLINE_PRICE : opts.onlinePrice,
      cashPrice: opts.cashPrice === undefined ? CASH_PRICE : opts.cashPrice,
      isOnline: false,
      capacity: 20,
      attendeeCount: 0,
      eventDate: START,
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 25,
      slug: 'demo-day',
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);

    d.users.push({
      id: 'user-1',
      email: 'u@example.com',
      fullName: 'Test User',
      phone: '+213700000000',
      role: 'ENTREPRENEUR',
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    } as never);

    d.wallets.push({
      id: 'wallet-1',
      userId: 'user-1',
      balance: opts.balance ?? 100_000,
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  });
}

async function walletBalance(): Promise<number> {
  const d = await db.read();
  return d.wallets.find((w) => w.userId === 'user-1')!.balance;
}

beforeEach(async () => {
  await seed();
});

/* ───────────────────────────── Pure resolver ───────────────────────────── */

describe('effectiveListingPrice', () => {
  it('picks the online override for ONLINE_FULL and the cash one for CASH_DEPOSIT', () => {
    const split = { onlinePrice: ONLINE_PRICE, cashPrice: CASH_PRICE };
    expect(effectiveListingPrice(CASH_PRICE, split, 'ONLINE_FULL')).toBe(ONLINE_PRICE);
    expect(effectiveListingPrice(CASH_PRICE, split, 'CASH_DEPOSIT')).toBe(CASH_PRICE);
  });

  it('falls back to the base price for whichever override is missing', () => {
    expect(effectiveListingPrice(24_000, { onlinePrice: 22_000 }, 'CASH_DEPOSIT')).toBe(24_000);
    expect(effectiveListingPrice(24_000, { cashPrice: 26_000 }, 'ONLINE_FULL')).toBe(24_000);
    expect(effectiveListingPrice(24_000, undefined, 'ONLINE_FULL')).toBe(24_000);
    expect(effectiveListingPrice(24_000, {}, 'CASH_DEPOSIT')).toBe(24_000);
  });

  it('treats a null / negative / non-finite override as absent', () => {
    expect(effectiveListingPrice(24_000, { onlinePrice: null }, 'ONLINE_FULL')).toBe(24_000);
    expect(effectiveListingPrice(24_000, { onlinePrice: -1 }, 'ONLINE_FULL')).toBe(24_000);
    expect(effectiveListingPrice(24_000, { onlinePrice: Number.NaN }, 'ONLINE_FULL')).toBe(24_000);
  });

  it('honours an explicit zero override — free by card, paid in cash', () => {
    expect(effectiveListingPrice(24_000, { onlinePrice: 0 }, 'ONLINE_FULL')).toBe(0);
    expect(effectiveListingPrice(24_000, { onlinePrice: 0 }, 'CASH_DEPOSIT')).toBe(24_000);
  });
});

describe('resolveListingPricing', () => {
  it('reports both surfaces and flags that they differ', () => {
    expect(resolveListingPricing(CASH_PRICE, { onlinePrice: ONLINE_PRICE, cashPrice: CASH_PRICE }))
      .toEqual({ online: ONLINE_PRICE, cash: CASH_PRICE, differs: true });
  });

  it('does not flag a difference when both resolve to the same amount', () => {
    expect(resolveListingPricing(24_000, undefined))
      .toEqual({ online: 24_000, cash: 24_000, differs: false });
    // Overrides set, but to the same number as each other.
    expect(resolveListingPricing(1, { onlinePrice: 500, cashPrice: 500 }))
      .toEqual({ online: 500, cash: 500, differs: false });
  });
});

describe('validateSplitPricing', () => {
  it('accepts absent and non-negative integer overrides', () => {
    expect(validateSplitPricing(undefined)).toBeNull();
    expect(validateSplitPricing({ onlinePrice: 0, cashPrice: 24_000 })).toBeNull();
  });

  it('rejects fractional and negative overrides', () => {
    expect(validateSplitPricing({ onlinePrice: 22_000.5 })).not.toBeNull();
    expect(validateSplitPricing({ cashPrice: -1 })).not.toBeNull();
  });
});

/* ─────────────────────── applyToProgram (the wallet) ─────────────────────── */

describe('applyToProgram charges the price for the CHOSEN method', () => {
  it('debits the ONLINE price, not the base/cash price', async () => {
    const before = await walletBalance();
    const res = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-online',
      paymentMethod: 'wallet',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // THE regression: this used to be CASH_PRICE.
    expect(res.booking.totalAmount).toBe(ONLINE_PRICE);
    expect(await walletBalance()).toBe(before - ONLINE_PRICE);
    expect(res.transaction?.amount).toBe(-ONLINE_PRICE);
  });

  it('records the CASH price on a reserve-on-site booking and debits nothing', async () => {
    const before = await walletBalance();
    const res = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-cash',
      paymentMethod: 'manual',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(CASH_PRICE);
    expect(res.booking.status).toBe('PENDING_PAYMENT');
    expect(res.transaction).toBeNull();
    expect(await walletBalance()).toBe(before);
  });

  it('falls back to the base price when no override is configured', async () => {
    await seed({ price: 18_000, onlinePrice: null, cashPrice: null });
    const res = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-nosplit',
      paymentMethod: 'wallet',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(18_000);
  });

  it('checks funds against the ONLINE price — a wallet holding exactly it succeeds', async () => {
    // Between the two prices: enough for the online seat, short of the cash one.
    await seed({ balance: ONLINE_PRICE });
    const res = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-exact',
      paymentMethod: 'wallet',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(ONLINE_PRICE);
    expect(await walletBalance()).toBe(0);
  });

  it('still reports INSUFFICIENT_FUNDS against the resolved (online) price', async () => {
    await seed({ balance: ONLINE_PRICE - 1 });
    const res = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-broke',
      paymentMethod: 'wallet',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('INSUFFICIENT_FUNDS');
    expect(res.required).toBe(ONLINE_PRICE);
  });

  it('replays on the same clientReference without a second debit', async () => {
    const first = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-replay',
      paymentMethod: 'wallet',
    });
    const after = await walletBalance();
    const second = await applyToProgram({
      userId: 'user-1',
      programId: 'prog-1',
      clientReference: 'ref-replay',
      paymentMethod: 'wallet',
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    expect(await walletBalance()).toBe(after);
  });
});

/* ─────────────────────── registerForEvent (the wallet) ─────────────────────── */

describe('registerForEvent charges the price for the CHOSEN method', () => {
  it('debits the ONLINE price, not the base/cash price', async () => {
    const before = await walletBalance();
    const res = await registerForEvent({
      userId: 'user-1',
      eventId: 'evt-1',
      clientReference: 'evt-online',
      paymentMethod: 'wallet',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(ONLINE_PRICE);
    expect(await walletBalance()).toBe(before - ONLINE_PRICE);
  });

  it('applies the membership discount ON TOP of the resolved online price', async () => {
    // 20 % off 22 000 = 17 600. Off the base 24 000 it would be 19 200 — the
    // ordering matters, and it must match card-payment.ts.
    const res = await registerForEvent({
      userId: 'user-1',
      eventId: 'evt-1',
      clientReference: 'evt-member',
      paymentMethod: 'wallet',
      membershipDiscount: 0.2,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(Math.round(ONLINE_PRICE * 0.8));
  });

  it('records the CASH price on a reserve-on-site registration', async () => {
    const res = await registerForEvent({
      userId: 'user-1',
      eventId: 'evt-1',
      clientReference: 'evt-cash',
      paymentMethod: 'manual',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.totalAmount).toBe(CASH_PRICE);
  });
});
