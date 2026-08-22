/**
 * Regression test for the Network-Pass payout-visit model.
 *
 * A NETWORK_PASS booking creates ONE visit row at booking time (checkedInAt
 * null — "booked"); physical check-in STAMPS that same row rather than inserting
 * a second one. This guarantees the partner-payout batch (which counts only
 * checked-in visits) is paid exactly once per booking — never twice.
 *
 * Exercises the real chain end-to-end:
 *   createSpaceBooking → generateCheckInCode → validateCheckInManual → recordCheckIn
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// The Network Pass feature ships switched OFF (see `@/config/feature-flags`).
// These tests are what keeps the redemption path alive for the day it is
// switched back on, so they run against the feature ENABLED — gating it would
// have quietly stopped exercising the thing this file exists to protect.
vi.mock('@/config/feature-flags', () => ({ isNetworkPassEnabled: () => true }));

import { db } from '@/server/db/store';
import { createSpaceBooking } from '@/server/bookings/service';
import {
  generateCheckInCode,
  validateCheckInManual,
  recordCheckIn,
} from '@/server/network/checkin-service';
import { getPartnerStats } from '@/server/network/partner-service';

const NOW = '2026-06-01T10:00:00.000Z';
const TODAY = new Date().toISOString().slice(0, 10);
const START = `${TODAY}T09:00:00.000Z`;
const END = `${TODAY}T11:00:00.000Z`;
const PAYOUT_RATE = 300;

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
    d.networkCheckInCodes = [];

    d.incubators.push({ id: 'inc-1', name: 'Inc', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com' } as never);
    d.partnerMemberships.push({
      id: 'pm-1', spaceId: 'space-1', networkPayoutRate: PAYOUT_RATE, isActive: true, acceptNetworkPasses: true,
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
      // Founder: Builder plans no longer include coworking passes.
      membershipCode: null, membershipTier: 'FOUNDER', networkCredits: 3, networkCreditsMax: 3,
      avatarUrl: null, locale: 'en', createdAt: NOW, updatedAt: NOW,
    } as never);
    d.wallets.push({ id: 'w-1', userId: 'user-1', balance: 0, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never);
  });
}

describe('Network-Pass visit model — one row per booking', () => {
  beforeEach(seed);

  it('book → check-in stamps the same row (never two), and payout counts once', async () => {
    // 1. Book with the Network Pass — creates the booking-time visit row.
    const res = await createSpaceBooking({
      booker: { type: 'user', userId: 'user-1' }, spaceId: 'space-1', unit: 'HOUR',
      startsAt: START, endsAt: END, clientReference: 'ref-1', paymentMethod: 'NETWORK_PASS',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bookingId = res.booking.id;

    let data = await db.read();
    const bookingTimeVisits = data.networkVisits!.filter((v) => v.bookingId === bookingId);
    expect(bookingTimeVisits).toHaveLength(1);
    expect(bookingTimeVisits[0]!.checkedInAt).toBeNull();
    const bookingVisitId = res.booking.networkVisitId;
    expect(bookingVisitId).toBe(bookingTimeVisits[0]!.id);

    // No payout yet — the booking-time row is not checked in.
    let stats = await getPartnerStats('pm-1');
    expect(stats.pendingPayout).toBe(0);

    // 2. Issue the check-in code and validate it.
    const { code } = await generateCheckInCode(bookingId);
    const validation = await validateCheckInManual('space-1', code, { staffUserId: 'mgr-1' });
    expect(validation.valid).toBe(true);
    // validate round-trips the booking's existing visit id.
    expect(validation.visitId).toBe(bookingVisitId);

    // 3. Record the check-in — must STAMP the existing row, not add a new one.
    const rec = await recordCheckIn(validation.visitId!, 'space-1', 'user-1', 'MANUAL', 'mgr-1');
    expect(rec.success).toBe(true);

    data = await db.read();
    const after = data.networkVisits!.filter((v) => v.bookingId === bookingId);
    expect(after).toHaveLength(1);                       // ← still exactly ONE row
    expect(after[0]!.id).toBe(bookingVisitId);           // same row id
    expect(after[0]!.checkedInAt).toBeTruthy();          // now stamped
    expect(after[0]!.checkedInMethod).toBe('MANUAL');

    // 4. Payout batch counts this booking exactly once.
    stats = await getPartnerStats('pm-1');
    expect(stats.pendingPayout).toBe(PAYOUT_RATE);
  });

  it('replaying recordCheckIn does not add a second row or double the payout', async () => {
    const res = await createSpaceBooking({
      booker: { type: 'user', userId: 'user-1' }, spaceId: 'space-1', unit: 'HOUR',
      startsAt: START, endsAt: END, clientReference: 'ref-2', paymentMethod: 'NETWORK_PASS',
    });
    if (!res.ok) throw new Error('seed booking failed');
    const bookingId = res.booking.id;
    const { code } = await generateCheckInCode(bookingId);
    const v = await validateCheckInManual('space-1', code, { staffUserId: 'mgr-1' });

    await recordCheckIn(v.visitId!, 'space-1', 'user-1', 'MANUAL', 'mgr-1');
    const replay = await recordCheckIn(v.visitId!, 'space-1', 'user-1', 'MANUAL', 'mgr-1');
    expect(replay.success).toBe(true);

    const data = await db.read();
    expect(data.networkVisits!.filter((x) => x.bookingId === bookingId)).toHaveLength(1);
    const stats = await getPartnerStats('pm-1');
    expect(stats.pendingPayout).toBe(PAYOUT_RATE); // not 600
  });
});
