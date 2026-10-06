/**
 * Incubator promo codes through the wallet booking services — the three
 * `validatePromoCodeSync` call sites in bookings/service.ts. The card-checkout
 * path is covered in incubator-promo-codes.test.ts; this file proves the other
 * three redeem a scoped code (and burn its use) only where it is ticked.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { createSpaceBooking, applyToProgram, registerForEvent } from '@/server/bookings/service';
import { createPromoCode } from '@/server/promo-codes/service';
import { createIncubatorPromoCode } from '@/server/promo-codes/incubator-service';

const NOW = '2026-06-01T10:00:00.000Z';
const A = 'inc-a';
const B = 'inc-b';

async function seed(): Promise<void> {
  await db.update((d) => {
    d.users = []; d.wallets = []; d.transactions = []; d.bookings = []; d.promoCodes = [];
    d.registrations = []; d.registrationFormFields = []; d.deskBookings = [];
    if (!d.meta) d.meta = {};
    d.meta.promoCodesSeeded = true;
    d.incubators = [
      { id: A, name: 'A', status: 'ACTIVE', managerId: 'mgr-a' } as never,
      { id: B, name: 'B', status: 'ACTIVE', managerId: 'mgr-b' } as never,
    ];
    const space = (id: string, incubatorId: string) => ({
      id, incubatorId, incubatorName: incubatorId, name: id, description: 'd', category: 'MEETING_ROOM',
      city: 'Alger', imageUrl: null, imageUrls: [], pricePerHour: null, pricePerDay: 10_000, capacity: 5,
      amenities: [], acceptedPaymentMethods: ['ONLINE'], workingDays: [0, 1, 2, 3, 4, 5, 6],
      openingTime: '00:00', closingTime: '23:59', durationDiscounts: [], unavailableDates: [], blackouts: [],
      isActive: true, createdAt: NOW, updatedAt: NOW,
    }) as never;
    d.spaces = [space('sa1', A), space('sa2', A), space('sb1', B)];
    const prog = (id: string, incubatorId: string) => ({
      id, incubatorId, incubatorName: incubatorId, mentorId: null, title: id, description: 'x', type: 'TRAINING',
      city: 'Alger', imageUrl: null, imageUrls: [], price: 10_000, seatsTotal: 20, seatsTaken: 0,
      deadline: '2030-01-01T00:00:00.000Z', startDate: '2030-02-01T11:00:00.000Z', endDate: '2030-03-01T11:00:00.000Z',
      acceptedPaymentMethods: ['ONLINE'], isActive: true, slug: id, createdAt: NOW, updatedAt: NOW,
    }) as never;
    d.programs = [prog('pa1', A), prog('pa2', A), prog('pb1', B)];
    d.events = [{
      id: 'ea1', incubatorId: A, incubatorName: 'A', title: 'ev', description: 'x', city: 'Alger', imageUrl: null,
      price: 10_000, capacity: 50, eventDate: '2030-05-01T10:00:00.000Z', acceptedPaymentMethods: ['ONLINE'],
      isActive: true, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.users.push({
      id: 'user-1', email: 'u@example.com', passwordHash: 'h', fullName: 'Test User', phone: '+213500000000',
      city: 'Alger', role: 'ENTREPRENEUR', status: 'ACTIVE', phoneVerified: true, emailVerified: true,
      membershipCode: null, membershipTier: 'EXPLORER', networkCredits: 0, networkCreditsMax: 0, avatarUrl: null,
      locale: 'en', createdAt: NOW, updatedAt: NOW,
    } as never);
    d.wallets.push({ id: 'w-1', userId: 'user-1', balance: 1_000_000, currency: 'DZD', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW } as never);
  });
}

beforeEach(seed);

let n = 0;
const ref = () => `ref-${++n}-${Math.random().toString(36).slice(2)}`;
const usedOf = async (code: string) => (await db.read()).promoCodes.find((c) => c.code === code)!.usedCount;

const book = (spaceId: string, promoCode: string) => createSpaceBooking({
  booker: { type: 'user', userId: 'user-1' }, spaceId, unit: 'DAY',
  startsAt: '2030-06-15T00:00:00.000Z', endsAt: '2030-06-16T00:00:00.000Z',
  clientReference: ref(), promoCode,
});

describe('createSpaceBooking (wallet)', () => {
  beforeEach(async () => {
    await createIncubatorPromoCode(A, { code: 'SPACE20', discountPercent: 20, expiresAt: null, usageLimit: null, programIds: [], spaceIds: ['sa1'] });
  });

  it('discounts the ticked space and burns one use', async () => {
    const r = await book('sa1', 'space20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.totalAmount).toBe(8_000);
    expect(await usedOf('SPACE20')).toBe(1);
  });

  it('charges full price, and burns nothing, on another space of the same incubator', async () => {
    const r = await book('sa2', 'SPACE20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.totalAmount).toBe(10_000);
    expect(r.booking.promoCodeId ?? null).toBeNull();
    expect(await usedOf('SPACE20')).toBe(0);
  });

  it('charges full price on another incubator\'s space', async () => {
    const r = await book('sb1', 'SPACE20');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.totalAmount).toBe(10_000);
    expect(await usedOf('SPACE20')).toBe(0);
  });
});

describe('applyToProgram (wallet)', () => {
  beforeEach(async () => {
    await createIncubatorPromoCode(A, { code: 'PROG30', discountPercent: 30, expiresAt: null, usageLimit: null, programIds: ['pa1'], spaceIds: [] });
  });

  it('discounts the ticked program and burns one use', async () => {
    const r = await applyToProgram({ userId: 'user-1', programId: 'pa1', clientReference: ref(), promoCode: 'PROG30' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.totalAmount).toBe(7_000);
    expect(await usedOf('PROG30')).toBe(1);
  });

  it('does not discount an unticked program or another incubator\'s', async () => {
    for (const programId of ['pa2', 'pb1']) {
      const r = await applyToProgram({ userId: 'user-1', programId, clientReference: ref(), promoCode: 'PROG30' });
      expect(r.ok, programId).toBe(true);
      if (!r.ok) continue;
      expect(r.booking.totalAmount, programId).toBe(10_000);
    }
    expect(await usedOf('PROG30')).toBe(0);
  });
});

describe('registerForEvent (wallet) — events are not scopable', () => {
  it('an incubator code never discounts an event, even its own incubator\'s', async () => {
    await createIncubatorPromoCode(A, { code: 'NOEVENT', discountPercent: 50, expiresAt: null, usageLimit: null, programIds: ['pa1'], spaceIds: [] });
    const r = await registerForEvent({ userId: 'user-1', eventId: 'ea1', clientReference: ref(), promoCode: 'NOEVENT' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.totalAmount).toBe(10_000);
    expect(await usedOf('NOEVENT')).toBe(0);
  });

  it('a platform code still discounts an event as before', async () => {
    await createPromoCode({ code: 'PLAT50', discountPercent: 50, appliesTo: 'ALL', expiresAt: null, usageLimit: null });
    const r = await registerForEvent({ userId: 'user-1', eventId: 'ea1', clientReference: ref(), promoCode: 'PLAT50' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.totalAmount).toBe(5_000);
  });
});
