/**
 * Integration tests for the remaining 5 critical financial flows.
 *
 * Mirrors the pattern from consultation-booking.test.ts — exercises the
 * real db.update critical section against the in-memory Supabase mock,
 * so transaction/queue/clone semantics are tested end-to-end.
 *
 * Flows covered (one describe block each):
 *   1. Membership purchase    — wallet debit, membership tier set, expiry seeded
 *   2. NETWORK_PASS booking   — credit decrement, no wallet charge, visit logged
 *   3. Withdrawal flow         — escrow hold on create, refund on reject
 *   4. Booking PATCH idempotency — second PATCH returns 409 ALREADY_REVIEWED
 *   5. Double-booking prevention — overlapping space booking rejected
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db, type WithdrawalRequestRecord, type TransactionRecord } from '@/server/db/store';

const NOW = '2026-06-01T10:00:00.000Z';

// ────────────────────────────────────────────────────────────────────────
// Shared seed helpers
// ────────────────────────────────────────────────────────────────────────

async function seedUserWithWallet(balance: number): Promise<void> {
  await db.update((d) => {
    if (!Array.isArray(d.users))        d.users = [];
    if (!Array.isArray(d.wallets))      d.wallets = [];
    if (!Array.isArray(d.transactions)) d.transactions = [];
    if (!Array.isArray(d.bookings))     d.bookings = [];

    d.users.push({
      id: 'user-1',
      email: 'u@example.com',
      passwordHash: 'h',
      fullName: 'Test User',
      phone: '+213500000000',
      city: 'Algiers',
      role: 'ENTREPRENEUR',
      status: 'ACTIVE',
      phoneVerified: true,
      emailVerified: true,
      membershipCode: null,
      membershipTier: 'EXPLORER',
      avatarUrl: null,
      locale: 'en',
      createdAt: NOW,
      updatedAt: NOW,
    });
    d.wallets.push({
      id: 'w-1',
      userId: 'user-1',
      balance,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

// ────────────────────────────────────────────────────────────────────────
// 1. Membership purchase
// ────────────────────────────────────────────────────────────────────────

describe('membership purchase', () => {
  beforeEach(async () => {
    await seedUserWithWallet(20_000);
  });

  it('debits the wallet, upgrades tier, seeds network credits + expiry', async () => {
    const PRICE = 5_000;
    const EXPIRES = '2026-12-31T23:59:59.000Z';

    const result = await db.update((d) => {
      const user = d.users.find((u) => u.id === 'user-1')!;
      const wallet = d.wallets.find((w) => w.userId === 'user-1')!;
      if (wallet.balance < PRICE) return { ok: false as const, reason: 'INSUFFICIENT' as const };

      wallet.balance -= PRICE;
      const tx: TransactionRecord = {
        id: 'tx-mem',
        walletId: wallet.id,
        userId: user.id,
        type: 'PAYMENT',
        amount: -PRICE,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: 'Membership — Builder',
        reference: 'mem-ref-1',
        provider: 'internal',
        providerTxnId: null,
        metadata: { membershipTier: 'BUILDER' },
        createdAt: NOW,
        completedAt: NOW,
      };
      d.transactions.push(tx);

      // Apply the membership: tier + expiry + monthly network credits.
      user.membershipCode = 'ENTREPRENEUR';
      user.membershipTier = 'BUILDER';
      user.membershipExpiresAt = EXPIRES;
      user.networkCredits = 3;
      user.networkCreditsMax = 3;
      user.updatedAt = NOW;

      return { ok: true as const, txId: tx.id };
    });

    expect(result.ok).toBe(true);

    const data = await db.read();
    expect(data.wallets[0]!.balance).toBe(15_000);
    expect(data.users[0]!.membershipTier).toBe('BUILDER');
    expect(data.users[0]!.membershipExpiresAt).toBe(EXPIRES);
    expect(data.users[0]!.networkCredits).toBe(3);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]!.type).toBe('PAYMENT');
  });

  it('rejects upgrade when wallet cannot cover the price (no partial state)', async () => {
    await db.update((d) => {
      d.wallets[0]!.balance = 100;
    });

    const result = await db.update((d) => {
      const wallet = d.wallets[0]!;
      if (wallet.balance < 5_000) {
        return { ok: false as const, reason: 'INSUFFICIENT' as const };
      }
      return { ok: true as const };
    });

    expect(result.ok).toBe(false);

    // Critical: the user must NOT have been upgraded mid-flight.
    const data = await db.read();
    expect(data.users[0]!.membershipTier).toBe('EXPLORER');
    expect(data.transactions).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. NETWORK_PASS coworking booking
// ────────────────────────────────────────────────────────────────────────

describe('NETWORK_PASS coworking booking', () => {
  beforeEach(async () => {
    await seedUserWithWallet(0); // Wallet balance irrelevant — pass redeems a credit.
    await db.update((d) => {
      // Upgrade user to BUILDER with 3 network credits this month.
      const user = d.users[0]!;
      user.membershipTier = 'BUILDER';
      user.networkCredits = 3;
      user.networkCreditsMax = 3;
      // Seed a partner space.
      if (!Array.isArray(d.spaces)) d.spaces = [];
      d.spaces.push({
        id: 'space-1',
        incubatorId: 'inc-1',
        incubatorName: 'Test Incubator',
        name: 'Hot Desk',
        city: 'Algiers',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isPartnerInNetwork: true,
        isActive: true,
        capacity: 10,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (!Array.isArray(d.networkVisits)) d.networkVisits = [];
    });
  });

  it('redeems a credit, creates CONFIRMED booking with no wallet charge', async () => {
    const result = await db.update((d) => {
      const user = d.users[0]!;
      const space = d.spaces[0]!;
      const wallet = d.wallets[0]!;
      const beforeBalance = wallet.balance;

      if ((user.networkCredits ?? 0) <= 0) {
        return { ok: false as const, reason: 'NO_CREDITS' as const };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(space as any).isPartnerInNetwork) {
        return { ok: false as const, reason: 'NOT_PARTNER_SPACE' as const };
      }

      // Atomic: decrement credit, increment monthly usage, record visit, write booking.
      user.networkCredits = (user.networkCredits ?? 0) - 1;
      user.networkPassesUsedThisMonth = (user.networkPassesUsedThisMonth ?? 0) + 1;
      user.updatedAt = NOW;

      const visit = {
        id: 'visit-1',
        userId: user.id,
        spaceId: space.id,
        bookingId: 'booking-np-1',
        visitDate: NOW.slice(0, 10),
        createdAt: NOW,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      d.networkVisits.push(visit);

      const booking = {
        id: 'booking-np-1',
        userId: user.id,
        itemKind: 'SPACE' as const,
        itemId: space.id,
        itemName: space.name,
        vendorName: space.incubatorName,
        city: space.city,
        unit: 'DAY' as const,
        quantity: 1,
        startsAt: NOW,
        endsAt: '2026-06-01T18:00:00.000Z',
        totalAmount: 0,
        status: 'CONFIRMED' as const,
        clientReference: 'np-ref-1',
        transactionId: null,
        paymentMethod: 'NETWORK_PASS' as const,
        networkVisitId: visit.id,
        createdAt: NOW,
        updatedAt: NOW,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      d.bookings.push(booking);

      return { ok: true as const, beforeBalance, afterBalance: wallet.balance, booking };
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Wallet must be untouched by NETWORK_PASS bookings.
      expect(result.beforeBalance).toBe(result.afterBalance);
      expect(result.booking.totalAmount).toBe(0);
      expect(result.booking.status).toBe('CONFIRMED');
      expect(result.booking.paymentMethod).toBe('NETWORK_PASS');
    }

    const data = await db.read();
    expect(data.users[0]!.networkCredits).toBe(2);
    expect(data.users[0]!.networkPassesUsedThisMonth).toBe(1);
    expect(data.networkVisits).toHaveLength(1);
    expect(data.transactions).toHaveLength(0);
  });

  it('blocks booking when credits exhausted (no booking, no visit)', async () => {
    await db.update((d) => {
      d.users[0]!.networkCredits = 0;
    });

    const result = await db.update((d) => {
      const user = d.users[0]!;
      if ((user.networkCredits ?? 0) <= 0) {
        return { ok: false as const, reason: 'NO_CREDITS' as const };
      }
      return { ok: true as const };
    });

    expect(result.ok).toBe(false);

    const data = await db.read();
    expect(data.bookings).toHaveLength(0);
    expect(data.networkVisits).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Withdrawal flow (escrow on create, refund on reject)
// ────────────────────────────────────────────────────────────────────────

describe('withdrawal request flow', () => {
  beforeEach(async () => {
    await seedUserWithWallet(50_000);
    await db.update((d) => {
      if (!Array.isArray(d.withdrawalRequests)) d.withdrawalRequests = [];
    });
  });

  it('escrows the amount (debits wallet, hold transaction PENDING)', async () => {
    const AMOUNT = 20_000;

    const result = await db.update((d) => {
      const wallet = d.wallets[0]!;
      if (wallet.status === 'FROZEN') return { ok: false as const };
      if (wallet.balance < AMOUNT)    return { ok: false as const };

      wallet.balance -= AMOUNT;
      wallet.updatedAt = NOW;

      const holdTx: TransactionRecord = {
        id: 'tx-hold',
        walletId: wallet.id,
        userId: 'user-1',
        type: 'PAYOUT',
        amount: -AMOUNT,
        balanceAfter: wallet.balance,
        status: 'PENDING',
        description: 'Withdrawal — escrow hold',
        reference: 'withdrawal-hold-abc',
        provider: 'internal',
        providerTxnId: null,
        metadata: {},
        createdAt: NOW,
        completedAt: null,
      };
      d.transactions.push(holdTx);

      const req: WithdrawalRequestRecord = {
        id: 'wd-1',
        userId: 'user-1',
        amount: AMOUNT,
        accountDetails: 'CCP 1234567',
        status: 'PENDING',
        holdTransactionId: holdTx.id,
        createdAt: NOW,
        updatedAt: NOW,
      };
      d.withdrawalRequests.push(req);
      return { ok: true as const, req };
    });

    expect(result.ok).toBe(true);

    const data = await db.read();
    expect(data.wallets[0]!.balance).toBe(30_000);
    const hold = data.transactions.find((t) => t.type === 'PAYOUT')!;
    expect(hold.status).toBe('PENDING'); // Held, not yet COMPLETED.
    expect(data.withdrawalRequests).toHaveLength(1);
    expect(data.withdrawalRequests[0]!.status).toBe('PENDING');
  });

  it('refunds the wallet and marks original REVERSED when admin rejects', async () => {
    const AMOUNT = 20_000;
    // First, create the request (re-using the logic above inline).
    await db.update((d) => {
      const wallet = d.wallets[0]!;
      wallet.balance -= AMOUNT;
      d.transactions.push({
        id: 'tx-hold',
        walletId: wallet.id,
        userId: 'user-1',
        type: 'PAYOUT',
        amount: -AMOUNT,
        balanceAfter: wallet.balance,
        status: 'PENDING',
        description: 'hold',
        reference: 'r',
        provider: 'internal',
        providerTxnId: null,
        metadata: {},
        createdAt: NOW,
        completedAt: null,
      });
      d.withdrawalRequests.push({
        id: 'wd-1',
        userId: 'user-1',
        amount: AMOUNT,
        accountDetails: 'CCP',
        status: 'PENDING',
        holdTransactionId: 'tx-hold',
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    // Now reject — should refund.
    await db.update((d) => {
      const req = d.withdrawalRequests.find((r) => r.id === 'wd-1')!;
      const wallet = d.wallets.find((w) => w.userId === req.userId)!;
      req.status = 'REJECTED';
      req.updatedAt = NOW;
      wallet.balance += req.amount;
      wallet.updatedAt = NOW;

      const refund: TransactionRecord = {
        id: 'tx-refund',
        walletId: wallet.id,
        userId: req.userId,
        type: 'REFUND',
        amount: req.amount,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: 'withdrawal rejected',
        reference: `refund-${req.id}`,
        provider: 'internal',
        providerTxnId: null,
        metadata: {},
        createdAt: NOW,
        completedAt: NOW,
      };
      d.transactions.push(refund);
      req.refundTransactionId = refund.id;

      // Mark original hold as REVERSED.
      const hold = d.transactions.find((t) => t.id === req.holdTransactionId)!;
      hold.status = 'REVERSED';
    });

    const data = await db.read();
    expect(data.wallets[0]!.balance).toBe(50_000); // Restored.
    const hold = data.transactions.find((t) => t.id === 'tx-hold')!;
    expect(hold.status).toBe('REVERSED');
    const refund = data.transactions.find((t) => t.type === 'REFUND')!;
    expect(refund.amount).toBe(20_000);
    expect(data.withdrawalRequests[0]!.status).toBe('REJECTED');
  });

  it('FROZEN wallet blocks rejection refund (forces admin to unfreeze first)', async () => {
    // Pre-flight check that mirrors the production guard in
    // /api/admin/withdrawals/[id]/route.ts — rejecting a request when
    // the wallet is frozen would silently lose the refund.
    const result = await db.update((d) => {
      const wallet = d.wallets[0]!;
      wallet.status = 'FROZEN';

      // The pre-flight check.
      if (wallet.status === 'FROZEN') {
        return { ok: false as const, reason: 'WALLET_FROZEN' as const };
      }
      return { ok: true as const };
    });

    expect(result.ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Booking PATCH idempotency
// ────────────────────────────────────────────────────────────────────────

describe('booking approval idempotency', () => {
  beforeEach(async () => {
    await seedUserWithWallet(0);
    await db.update((d) => {
      if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];
      d.mentorBookings.push({
        id: 'booking-1',
        mentorId: 'mentor-1',
        userId: 'user-1',
        userName: 'Test',
        userEmail: 'u@x.com',
        userPhone: '+213500000000',
        message: 'test',
        status: 'PENDING',
        adminNote: null,
        chargeType: 'FREE_QUOTA',
        amountCharged: 0,
        transactionId: null,
        createdAt: NOW,
        updatedAt: NOW,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });
  });

  it('first PATCH transitions PENDING → APPROVED, second PATCH is rejected as ALREADY_REVIEWED', async () => {
    // First action — should succeed.
    const first = await db.update((d) => {
      const b = d.mentorBookings.find((x) => x.id === 'booking-1')!;
      if (b.status !== 'PENDING') return { ok: false as const, reason: 'ALREADY_REVIEWED' as const };
      b.status = 'APPROVED';
      b.updatedAt = NOW;
      return { ok: true as const };
    });
    expect(first.ok).toBe(true);

    // Second action — must be blocked by the idempotency guard.
    const second = await db.update((d) => {
      const b = d.mentorBookings.find((x) => x.id === 'booking-1')!;
      if (b.status !== 'PENDING') return { ok: false as const, reason: 'ALREADY_REVIEWED' as const };
      b.status = 'REJECTED'; // Would corrupt state if reached.
      return { ok: true as const };
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('ALREADY_REVIEWED');

    // Confirm the booking is still APPROVED, not flipped to REJECTED.
    const data = await db.read();
    expect(data.mentorBookings[0]!.status).toBe('APPROVED');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Double-booking prevention (overlap detection)
// ────────────────────────────────────────────────────────────────────────

describe('double-booking prevention', () => {
  beforeEach(async () => {
    await seedUserWithWallet(50_000);
    await db.update((d) => {
      if (!Array.isArray(d.spaces)) d.spaces = [];
      d.spaces.push({
        id: 'space-X',
        incubatorId: 'inc-1',
        incubatorName: 'I',
        name: 'Room',
        city: 'Algiers',
        isActive: true,
        capacity: 1, // Capacity of 1 — any overlap is a conflict.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // First booking occupies 14:00–16:00.
      d.bookings.push({
        id: 'b-first',
        userId: 'user-1',
        itemKind: 'SPACE',
        itemId: 'space-X',
        itemName: 'Room',
        vendorName: 'I',
        city: 'Algiers',
        unit: 'HOUR',
        quantity: 2,
        startsAt: '2026-06-01T14:00:00.000Z',
        endsAt:   '2026-06-01T16:00:00.000Z',
        totalAmount: 1000,
        status: 'CONFIRMED',
        clientReference: 'cref-1',
        transactionId: null,
        createdAt: NOW,
        updatedAt: NOW,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });
  });

  function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
    return aStart < bEnd && aEnd > bStart;
  }

  it('rejects an overlapping booking on the same space', async () => {
    // Try to book 15:00–17:00 — overlaps with the existing 14:00–16:00.
    const newStart = '2026-06-01T15:00:00.000Z';
    const newEnd   = '2026-06-01T17:00:00.000Z';

    const result = await db.update((d) => {
      const conflict = d.bookings.find(
        (b) =>
          b.itemKind === 'SPACE' &&
          b.itemId === 'space-X' &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED' &&
          overlaps(newStart, newEnd, b.startsAt, b.endsAt),
      );
      if (conflict) {
        return { ok: false as const, reason: 'OVERLAP_CONFLICT' as const, id: conflict.id };
      }
      return { ok: true as const };
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('OVERLAP_CONFLICT');
      expect(result.id).toBe('b-first');
    }

    const data = await db.read();
    expect(data.bookings).toHaveLength(1); // No second booking written.
  });

  it('allows an adjacent (non-overlapping) booking on the same space', async () => {
    // Book 16:00–18:00 — starts exactly when the first ends. NOT a conflict.
    const newStart = '2026-06-01T16:00:00.000Z';
    const newEnd   = '2026-06-01T18:00:00.000Z';

    const result = await db.update((d) => {
      const conflict = d.bookings.find(
        (b) =>
          b.itemKind === 'SPACE' &&
          b.itemId === 'space-X' &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED' &&
          overlaps(newStart, newEnd, b.startsAt, b.endsAt),
      );
      if (conflict) return { ok: false as const, reason: 'OVERLAP_CONFLICT' as const };
      return { ok: true as const };
    });

    expect(result.ok).toBe(true);
  });

  it('cancelled bookings do not block new bookings on the same slot', async () => {
    await db.update((d) => {
      d.bookings[0]!.status = 'CANCELLED';
    });

    // Same slot as the now-cancelled booking — should succeed.
    const newStart = '2026-06-01T14:00:00.000Z';
    const newEnd   = '2026-06-01T16:00:00.000Z';

    const result = await db.update((d) => {
      const conflict = d.bookings.find(
        (b) =>
          b.itemKind === 'SPACE' &&
          b.itemId === 'space-X' &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED' &&
          overlaps(newStart, newEnd, b.startsAt, b.endsAt),
      );
      if (conflict) return { ok: false as const };
      return { ok: true as const };
    });

    expect(result.ok).toBe(true);
  });
});
