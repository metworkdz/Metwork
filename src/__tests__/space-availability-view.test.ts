/**
 * Unit tests for the pure availability-view adapter — the seam that turns the
 * canonical `GET /api/spaces/:id/availability` intervals into calendar buckets
 * and hourly slots. These assert the UI gate matches the server's intent
 * (DAY needs the whole day free; HOUR needs one open hour) without any store.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDayInfos,
  daySlotsFromIntervals,
  monthRange,
  ownerBuckets,
  publicBuckets,
  type SpaceAvailabilityResponse,
} from '@/lib/space-availability-view';

const TODAY = '2030-01-01';

/** A 3-day window (07–09 Jan 2030, all future vs TODAY): 07 fully blocked, 08 has
 *  a 10:00–11:00 booking, 09 is wide open. Capacity 1, all-week, 09:00–18:00. */
function fixture(): SpaceAvailabilityResponse {
  return {
    spaceId: 'sp1',
    from: '2030-01-07T00:00:00.000Z',
    to: '2030-01-09T00:00:00.000Z',
    capacity: 1,
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    openingTime: '09:00',
    closingTime: '18:00',
    intervals: [
      { start: '2030-01-07T00:00:00.000Z', end: '2030-01-08T00:00:00.000Z', kind: 'BLOCK', allDay: true },
      { start: '2030-01-08T10:00:00.000Z', end: '2030-01-08T11:00:00.000Z', kind: 'BOOKING', allDay: false },
    ],
  };
}

describe('monthRange', () => {
  it('returns first/last day of a 28-day month', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('handles a leap February', () => {
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('daySlotsFromIntervals', () => {
  it('frees every working hour on an empty future day', () => {
    const slots = daySlotsFromIntervals('2030-01-09', fixture(), { today: TODAY });
    expect(slots).toHaveLength(9); // 09→18, hourly
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('marks only the booked hour unavailable', () => {
    const slots = daySlotsFromIntervals('2030-01-08', fixture(), { today: TODAY });
    const taken = slots.filter((s) => !s.available);
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ start: '10:00', end: '11:00' });
  });

  it('blocks the whole day for an all-day block', () => {
    const slots = daySlotsFromIntervals('2030-01-07', fixture(), { today: TODAY });
    expect(slots.every((s) => !s.available)).toBe(true);
  });

  it('treats past days as fully unavailable', () => {
    const slots = daySlotsFromIntervals('2030-01-08', fixture(), { today: '2030-02-01' });
    expect(slots.every((s) => !s.available)).toBe(true);
  });

  it('treats non-working days as unavailable', () => {
    const res = { ...fixture(), workingDays: [] };
    const slots = daySlotsFromIntervals('2030-01-09', res, { today: TODAY });
    expect(slots.every((s) => !s.available)).toBe(true);
  });
});

describe('computeDayInfos + publicBuckets', () => {
  it('DAY unit: any booking or block makes the day unselectable', () => {
    const infos = computeDayInfos(fixture(), { unit: 'DAY', today: TODAY });
    const { availableDates, bookedDates, blockedDates } = publicBuckets(infos);
    expect(availableDates).toEqual(['2030-01-09']);
    expect(bookedDates).toEqual(['2030-01-08']); // partial booking blocks a full-day booking
    expect(blockedDates).toEqual(['2030-01-07']);
  });

  it('HOUR unit: a partially-booked day stays selectable', () => {
    const infos = computeDayInfos(fixture(), { unit: 'HOUR', today: TODAY });
    const { availableDates, bookedDates, blockedDates } = publicBuckets(infos);
    expect(availableDates).toEqual(['2030-01-08', '2030-01-09']);
    expect(bookedDates).toEqual([]); // 08 is selectable → not surfaced as booked
    expect(blockedDates).toEqual(['2030-01-07']); // whole-day block leaves no free hour
  });
});

describe('ownerBuckets', () => {
  it('surfaces blocked and booked days; block wins over booking', () => {
    const infos = computeDayInfos(fixture(), { unit: 'DAY', today: TODAY });
    expect(ownerBuckets(infos)).toEqual({
      bookedDates: ['2030-01-08'],
      blockedDates: ['2030-01-07'],
    });
  });

  it('a day that is both blocked and booked counts as blocked only', () => {
    const res = fixture();
    res.intervals.push({
      start: '2030-01-07T12:00:00.000Z',
      end: '2030-01-07T13:00:00.000Z',
      kind: 'BOOKING',
      allDay: false,
    });
    const infos = computeDayInfos(res, { unit: 'DAY', today: TODAY });
    const { bookedDates, blockedDates } = ownerBuckets(infos);
    expect(blockedDates).toContain('2030-01-07');
    expect(bookedDates).not.toContain('2030-01-07');
  });
});
