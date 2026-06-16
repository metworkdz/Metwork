/**
 * Unit tests for the shared space-availability validator and the duration
 * discount helper — the authoritative gate every booking path calls.
 *
 * Pure functions, no DB: we hand-build a bookings snapshot and assert the
 * blackout, capacity-aware occupancy (mixed-mode), and discount outcomes.
 */
import { describe, it, expect } from 'vitest';
import {
  checkSpaceAvailability,
  bestDurationDiscountPercent,
  type AvailabilitySpace,
} from '@/server/bookings/availability';
import { unitPrice, availableUnits, computeQuantity, type SpacePricing } from '@/server/bookings/service';
import type { BookingRecord } from '@/server/db/store';

const D = '2026-06-05';

function booking(p: Partial<BookingRecord>): BookingRecord {
  return {
    id: p.id ?? 'b',
    userId: null,
    itemKind: 'SPACE',
    itemId: 'space-1',
    itemName: 'Room',
    vendorName: 'Inc',
    city: 'Algiers',
    unit: 'HOUR',
    quantity: 1,
    startsAt: `${D}T09:00:00.000Z`,
    endsAt: `${D}T12:00:00.000Z`,
    totalAmount: 0,
    status: 'CONFIRMED',
    clientReference: p.id ?? 'b',
    transactionId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...p,
  } as BookingRecord;
}

const room = (over: Partial<AvailabilitySpace> = {}): AvailabilitySpace => ({
  capacity: 1,
  unavailableDates: [],
  blackouts: [],
  ...over,
});

function check(space: AvailabilitySpace, bookings: BookingRecord[], unit: BookingRecord['unit'], startsAt: string, endsAt: string) {
  return checkSpaceAvailability({ space, bookings, spaceId: 'space-1', unit, startsAt, endsAt });
}

describe('checkSpaceAvailability — blackouts', () => {
  it('rejects a full-day blackout (unavailableDates) for everyone', () => {
    const r = check(room({ unavailableDates: [D] }), [], 'DAY', `${D}T09:00:00.000Z`, `${D}T18:00:00.000Z`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('DATE_UNAVAILABLE');
  });

  it('rejects a whole-day blackout entry (no from/to)', () => {
    const r = check(room({ blackouts: [{ date: D }] }), [], 'HOUR', `${D}T10:00:00.000Z`, `${D}T11:00:00.000Z`);
    expect(r.ok).toBe(false);
  });

  it('rejects an hourly window overlapping a time-range blackout', () => {
    const r = check(room({ blackouts: [{ date: D, from: '12:00', to: '14:00' }] }), [], 'HOUR', `${D}T13:00:00.000Z`, `${D}T14:00:00.000Z`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('DATE_UNAVAILABLE');
  });

  it('allows an hourly window outside a time-range blackout', () => {
    const r = check(room({ blackouts: [{ date: D, from: '12:00', to: '14:00' }] }), [], 'HOUR', `${D}T09:00:00.000Z`, `${D}T10:00:00.000Z`);
    expect(r.ok).toBe(true);
  });
});

describe('checkSpaceAvailability — capacity 1 (training room / office)', () => {
  it('an existing hourly booking blocks a FULL-DAY booking that day', () => {
    const existing = [booking({ id: 'h', unit: 'HOUR', startsAt: `${D}T09:00:00.000Z`, endsAt: `${D}T12:00:00.000Z` })];
    const r = check(room(), existing, 'DAY', `${D}T09:00:00.000Z`, `${D}T18:00:00.000Z`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('OVERLAP_CONFLICT');
  });

  it('an existing FULL-DAY booking blocks any hourly booking that day', () => {
    const existing = [booking({ id: 'd', unit: 'DAY', startsAt: `${D}T09:00:00.000Z`, endsAt: `${D}T18:00:00.000Z` })];
    const r = check(room(), existing, 'HOUR', `${D}T14:00:00.000Z`, `${D}T15:00:00.000Z`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('OVERLAP_CONFLICT');
  });

  it('allows another hourly booking in the still-free hours of the day', () => {
    const existing = [booking({ id: 'h', unit: 'HOUR', startsAt: `${D}T09:00:00.000Z`, endsAt: `${D}T12:00:00.000Z` })];
    const r = check(room(), existing, 'HOUR', `${D}T13:00:00.000Z`, `${D}T14:00:00.000Z`);
    expect(r.ok).toBe(true);
  });

  it('PENDING_PAYMENT bookings hold no seat', () => {
    const existing = [booking({ id: 'p', unit: 'HOUR', status: 'PENDING_PAYMENT', startsAt: `${D}T09:00:00.000Z`, endsAt: `${D}T12:00:00.000Z` })];
    const r = check(room(), existing, 'HOUR', `${D}T10:00:00.000Z`, `${D}T11:00:00.000Z`);
    expect(r.ok).toBe(true);
  });
});

describe('checkSpaceAvailability — capacity 5 (coworking desks)', () => {
  const coworking = room({ capacity: 5 });
  const dayOn = (id: string, date: string) =>
    booking({ id, unit: 'DAY', startsAt: `${date}T09:00:00.000Z`, endsAt: `${date}T18:00:00.000Z` });

  it('allows a month booking when desks remain on every covered day', () => {
    // One desk taken on June 5 → 4 left; a month from June 5 still fits.
    const r = check(coworking, [dayOn('a', D)], 'MONTH', `${D}T09:00:00.000Z`, '2026-07-05T18:00:00.000Z');
    expect(r.ok).toBe(true);
  });

  it('rejects the (capacity+1)-th concurrent booking on a day', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => dayOn(id, D));
    const r = check(coworking, five, 'DAY', `${D}T09:00:00.000Z`, `${D}T18:00:00.000Z`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('CAPACITY_EXCEEDED');
  });

  it('allows a booking on a different day even when one day is full', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => dayOn(id, D));
    const r = check(coworking, five, 'DAY', '2026-06-06T09:00:00.000Z', '2026-06-06T18:00:00.000Z');
    expect(r.ok).toBe(true);
  });
});

describe('bestDurationDiscountPercent', () => {
  const rules = [
    { unit: 'DAY' as const, minQty: 3, percent: 10 },
    { unit: 'HOUR' as const, minQty: 20, percent: 15 },
  ];

  it('applies the day rule to a 3-day booking', () => {
    expect(bestDurationDiscountPercent(rules, 'DAY', 3)).toBe(10);
  });
  it('applies the hour rule to a 20-hour booking', () => {
    expect(bestDurationDiscountPercent(rules, 'HOUR', 20)).toBe(15);
  });
  it('returns 0 below the threshold', () => {
    expect(bestDurationDiscountPercent(rules, 'DAY', 2)).toBe(0);
  });
  it('returns 0 with no rules', () => {
    expect(bestDurationDiscountPercent([], 'DAY', 30)).toBe(0);
  });
  it('picks the highest qualifying percent', () => {
    const stacked = [
      { unit: 'DAY' as const, minQty: 3, percent: 10 },
      { unit: 'DAY' as const, minQty: 7, percent: 20 },
    ];
    expect(bestDurationDiscountPercent(stacked, 'DAY', 7)).toBe(20);
  });
  it('ignores invalid rules (percent ≥ 100)', () => {
    expect(bestDurationDiscountPercent([{ unit: 'DAY', minQty: 1, percent: 150 }], 'DAY', 5)).toBe(0);
  });
});

describe('half-day pricing (Phase 2)', () => {
  const priced: SpacePricing = {
    pricePerHour: 500,
    pricePerHalfDay: 1500,
    pricePerDay: 3000,
    pricePerMonth: 50_000,
  };

  it('prices a HALF_DAY booking at the flat half-day rate', () => {
    expect(unitPrice(priced, 'HALF_DAY')).toBe(1500);
  });
  it('falls back to cash half-day price when set', () => {
    expect(unitPrice({ ...priced, cashPricePerHalfDay: 1200 }, 'HALF_DAY', 'CASH_DEPOSIT')).toBe(1200);
  });
  it('exposes HALF_DAY only when a half-day price is set, in order', () => {
    expect(availableUnits(priced)).toEqual(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']);
    expect(availableUnits({ ...priced, pricePerHalfDay: null })).toEqual(['HOUR', 'DAY', 'MONTH']);
  });
  it('a half-day is always quantity 1', () => {
    expect(computeQuantity(`${D}T09:00:00.000Z`, `${D}T13:00:00.000Z`, 'HALF_DAY')).toBe(1);
  });
});

describe('half-day occupancy (capacity 1)', () => {
  const halfDay = (id: string, from: string, to: string) =>
    booking({ id, unit: 'HALF_DAY', startsAt: `${D}T${from}:00.000Z`, endsAt: `${D}T${to}:00.000Z` });

  it('lets a morning and an afternoon half-day coexist on a capacity-1 room', () => {
    const existing = [halfDay('am', '09:00', '13:00')];
    const r = check(room(), existing, 'HALF_DAY', `${D}T13:00:00.000Z`, `${D}T17:00:00.000Z`);
    expect(r.ok).toBe(true);
  });
  it('rejects an overlapping half-day on a capacity-1 room', () => {
    const existing = [halfDay('am', '09:00', '13:00')];
    const r = check(room(), existing, 'HALF_DAY', `${D}T12:00:00.000Z`, `${D}T16:00:00.000Z`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('OVERLAP_CONFLICT');
  });
  it('a half-day booking blocks a full-day booking that day', () => {
    const existing = [halfDay('am', '09:00', '13:00')];
    const r = check(room(), existing, 'DAY', `${D}T09:00:00.000Z`, `${D}T18:00:00.000Z`);
    expect(r.ok).toBe(false);
  });
  it('leaves the rest of the day hourly-bookable around a half-day', () => {
    const existing = [halfDay('am', '09:00', '13:00')];
    const r = check(room(), existing, 'HOUR', `${D}T15:00:00.000Z`, `${D}T16:00:00.000Z`);
    expect(r.ok).toBe(true);
  });
});
