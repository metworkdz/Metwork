/**
 * The Network Pass feature gate, asserted from the server side.
 *
 * Network Pass ships switched OFF (`@/config/feature-flags`). Hiding the UI is
 * not the same as disabling the feature: a redemption creates a CONFIRMED,
 * zero-cost booking that holds real inventory and burns a credit, so the
 * booking service has to refuse on its own rather than trusting that no client
 * will ask. This file is the test for that refusal.
 *
 * The companion suites (`network-pass-visit`, `booking-idempotency`) mock the
 * flag ON and keep exercising the redemption path itself, so both states stay
 * covered while the feature is dormant.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/config/feature-flags', () => ({ isNetworkPassEnabled: () => false }));

import { db } from '@/server/db/store';
import { createSpaceBooking } from '@/server/bookings/service';

const NOW = '2026-06-01T10:00:00.000Z';
const TODAY = new Date().toISOString().slice(0, 10);
const START = `${TODAY}T09:00:00.000Z`;
const END = `${TODAY}T11:00:00.000Z`;

/** A member who WOULD be eligible: partner space, paid tier, credits in hand. */
async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = [];
    d.wallets = [];
    d.transactions = [];
    d.bookings = [];
    d.spaces = [];
    d.incubators = [];
    d.partnerMemberships = [];
    d.networkVisits = [];

    d.incubators.push({ id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never);
    d.partnerMemberships.push({
      id: 'pm-1', spaceId: 'space-1', networkPayoutRate: 300, isActive: true, acceptNetworkPasses: true,
    } as never);
    d.spaces.push({
      id: 'space-1', incubatorId: 'inc-1', incubatorName: 'Inc', name: 'Hot Desk', description: 'd',
      category: 'COWORKING', city: 'Algiers', imageUrl: null, imageUrls: [],
      pricePerHour: 500, pricePerHalfDay: null, pricePerDay: 3000, pricePerMonth: 40000,
      capacity: 5, amenities: [], acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: null, cashDepositValue: null,
      workingDays: [0, 1, 2, 3, 4, 5, 6], openingTime: '00:00', closingTime: '23:59',
      durationDiscounts: [], unavailableDates: [], blackouts: [],
      isActive: true, isPartnerInNetwork: true, partnerMembershipId: 'pm-1',
      createdAt: NOW, updatedAt: NOW,
    } as never);
    d.users.push({
      id: 'user-1', email: 'u@x.com', passwordHash: 'h', fullName: 'Member', phone: '+213500000000',
      city: 'Algiers', role: 'ENTREPRENEUR', status: 'ACTIVE', phoneVerified: true, emailVerified: true,
      membershipCode: null, membershipTier: 'FOUNDER', networkCredits: 3, networkCreditsMax: 3,
      avatarUrl: null, locale: 'en', createdAt: NOW, updatedAt: NOW,
    } as never);
    d.wallets.push({ id: 'w-1', userId: 'user-1', balance: 0, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never);
  });
}

describe('Network Pass redemption while the feature is off', () => {
  beforeEach(seed);

  it('rejects an otherwise-valid redemption with NETWORK_PASS_DISABLED', async () => {
    const res = await createSpaceBooking({
      booker: { type: 'user', userId: 'user-1' }, spaceId: 'space-1', unit: 'HOUR',
      startsAt: START, endsAt: END, clientReference: 'gated-1', paymentMethod: 'NETWORK_PASS',
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Distinct from TIER_NOT_ELIGIBLE / NO_CREDITS on purpose: this member is
    // eligible and funded. Reusing those reasons would tell them something
    // untrue about their own account.
    expect(res.reason).toBe('NETWORK_PASS_DISABLED');
  });

  it('burns no credit and creates no booking or visit row', async () => {
    await createSpaceBooking({
      booker: { type: 'user', userId: 'user-1' }, spaceId: 'space-1', unit: 'HOUR',
      startsAt: START, endsAt: END, clientReference: 'gated-2', paymentMethod: 'NETWORK_PASS',
    });

    const data = await db.read();
    expect(data.users.find((u) => u.id === 'user-1')?.networkCredits).toBe(3);
    expect(data.bookings).toHaveLength(0);
    expect(data.networkVisits ?? []).toHaveLength(0);
  });

  it('leaves ordinary wallet bookings at the same space untouched', async () => {
    // The gate must be scoped to the redemption path — a partner space is still
    // a normal bookable space while Network Pass is off.
    await db.update((d) => {
      const w = d.wallets.find((x) => x.userId === 'user-1');
      if (w) w.balance = 100_000;
    });

    const res = await createSpaceBooking({
      booker: { type: 'user', userId: 'user-1' }, spaceId: 'space-1', unit: 'HOUR',
      startsAt: START, endsAt: END, clientReference: 'wallet-1', paymentMethod: 'wallet',
    });

    expect(res.ok).toBe(true);
  });
});
