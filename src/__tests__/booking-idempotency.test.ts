/**
 * Regression tests for createSpaceBooking idempotency on replay (P1-2).
 *
 * The replay short-circuit used to fire only when the existing booking carried
 * a stored transaction. Cash (`manual`) and NETWORK_PASS bookings have
 * transactionId === null, so a same-clientReference retry fell through and
 * created a SECOND booking — double-burning a network credit (and a second
 * partner-payout visit) or duplicating a cash reservation. These tests drive
 * the real db.update critical section against the in-memory store and assert
 * that a replay returns the original booking and moves nothing twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { createSpaceBooking } from '@/server/bookings/service';

const NOW = '2026-06-01T10:00:00.000Z';
const START = '2026-06-15T09:00:00.000Z';
const END = '2026-06-15T11:00:00.000Z';

async function seed(opts: { tier?: string; credits?: number; partner?: boolean } = {}): Promise<void> {
  await db.update((d) => {
    d.users = [];
    d.wallets = [];
    d.transactions = [];
    d.bookings = [];
    d.spaces = [];
    d.incubators = [];
    d.partnerMemberships = [];
    d.networkVisits = [];

    d.incubators.push({
      id: 'inc-1',
      name: 'Test Incubator',
      status: 'ACTIVE',
      managerId: 'mgr-1',
    } as never);

    d.spaces.push({
      id: 'space-1',
      incubatorId: 'inc-1',
      incubatorName: 'Test Incubator',
      name: 'Hot Desk',
      description: 'desk',
      category: 'COWORKING',
      city: 'Algiers',
      imageUrl: null,
      imageUrls: [],
      pricePerHour: 500,
      pricePerHalfDay: null,
      pricePerDay: 3000,
      pricePerMonth: 40000,
      capacity: 5, // > 1 so a second NETWORK_PASS booking is NOT blocked by capacity
      amenities: [],
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: null,
      cashDepositValue: null,
      // All days, all hours → sidestep working-hours validation entirely.
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      openingTime: '00:00',
      closingTime: '23:59',
      durationDiscounts: [],
      unavailableDates: [],
      blackouts: [],
      isActive: true,
      isPartnerInNetwork: opts.partner ?? false,
      partnerMembershipId: opts.partner ? 'pm-1' : null,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);

    if (opts.partner) {
      d.partnerMemberships.push({
        id: 'pm-1',
        spaceId: 'space-1',
        networkPayoutRate: 300,
        isActive: true,
        acceptNetworkPasses: true,
      } as never);
    }

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
      membershipTier: opts.tier ?? 'EXPLORER',
      networkCredits: opts.credits ?? 0,
      networkCreditsMax: opts.credits ?? 0,
      avatarUrl: null,
      locale: 'en',
      createdAt: NOW,
      updatedAt: NOW,
    } as never);

    d.wallets.push({
      id: 'w-1',
      userId: 'user-1',
      balance: 100000,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  });
}

describe('createSpaceBooking — NETWORK_PASS replay idempotency', () => {
  beforeEach(async () => {
    // Founder: Builder plans no longer include coworking passes.
    await seed({ tier: 'FOUNDER', credits: 3, partner: true });
  });

  it('a same-clientReference replay returns the original booking and burns exactly one credit', async () => {
    const args = {
      booker: { type: 'user' as const, userId: 'user-1' },
      spaceId: 'space-1',
      unit: 'HOUR' as const,
      startsAt: START,
      endsAt: END,
      clientReference: 'ref-network-pass-1',
      paymentMethod: 'NETWORK_PASS' as const,
    };

    const first = await createSpaceBooking(args);
    const second = await createSpaceBooking(args);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Same booking returned, second flagged as a replay.
    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);

    const data = await db.read();
    // Exactly one booking, one visit, one credit consumed.
    expect(data.bookings.filter((b) => b.clientReference === 'ref-network-pass-1')).toHaveLength(1);
    expect((data.networkVisits ?? []).length).toBe(1);
    expect(data.users[0]!.networkCredits).toBe(2);
  });
});

describe('createSpaceBooking — cash (manual) replay idempotency', () => {
  beforeEach(async () => {
    await seed();
  });

  it('a same-clientReference replay returns the original reservation, not a duplicate', async () => {
    const args = {
      booker: { type: 'user' as const, userId: 'user-1' },
      spaceId: 'space-1',
      unit: 'HOUR' as const,
      startsAt: START,
      endsAt: END,
      clientReference: 'ref-cash-1',
      paymentMethod: 'manual' as const,
    };

    const first = await createSpaceBooking(args);
    const second = await createSpaceBooking(args);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);

    const data = await db.read();
    expect(data.bookings.filter((b) => b.clientReference === 'ref-cash-1')).toHaveLength(1);
  });
});

describe('createSpaceBooking — wallet replay idempotency (unchanged behaviour)', () => {
  beforeEach(async () => {
    await seed();
  });

  it('a wallet replay returns the original booking and debits once', async () => {
    const args = {
      booker: { type: 'user' as const, userId: 'user-1' },
      spaceId: 'space-1',
      unit: 'HOUR' as const,
      startsAt: START,
      endsAt: END,
      clientReference: 'ref-wallet-1',
      paymentMethod: 'wallet' as const,
    };

    const first = await createSpaceBooking(args);
    const second = await createSpaceBooking(args);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);

    const data = await db.read();
    expect(data.bookings.filter((b) => b.clientReference === 'ref-wallet-1')).toHaveLength(1);
    // 2 hours × 500 = 1000 debited exactly once.
    expect(data.wallets[0]!.balance).toBe(100000 - 1000);
  });
});
