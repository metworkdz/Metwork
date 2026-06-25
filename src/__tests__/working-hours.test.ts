/**
 * Focused unit coverage for the booking working-hours gate and the per-day
 * occupancy decomposition that the canonical availability engine is built on.
 *
 *  - validateWorkingHours: working-day membership + opening/closing bounds.
 *  - occupiedIntervals: HOUR/HALF_DAY occupy only their minutes; DAY/MONTH (and
 *    multi-day spans) occupy whole calendar days; a zero-length window is inert.
 *
 * Pure functions — no store. Dates are built in UTC because the gate derives
 * day-of-week and HH:MM in UTC (see service.ts: isoToUtcDow / isoToUtcMinutes).
 * Anchor: 2026-01-01 is a Thursday (UTC); 2026-01-04 is a Sunday.
 */
import { describe, it, expect } from 'vitest';
import { validateWorkingHours } from '@/server/bookings/service';
import { occupiedIntervals } from '@/server/bookings/availability';

const WEEKDAYS = [1, 2, 3, 4, 5];
const THU = '2026-01-01'; // Thursday (UTC)
const SUN = '2026-01-04'; // Sunday (UTC)
const at = (date: string, h: number) => `${date}T${String(h).padStart(2, '0')}:00:00.000Z`;

describe('validateWorkingHours', () => {
  const space = { workingDays: WEEKDAYS, openingTime: '09:00', closingTime: '18:00' };

  it('accepts a weekday window inside opening/closing', () => {
    expect(validateWorkingHours(at(THU, 9), at(THU, 11), space)).toBeNull();
    expect(validateWorkingHours(at(THU, 9), at(THU, 18), space)).toBeNull(); // end == closing is OK
  });

  it('rejects a start before opening', () => {
    expect(validateWorkingHours(at(THU, 7), at(THU, 8), space)).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('rejects an end after closing', () => {
    expect(validateWorkingHours(at(THU, 17), at(THU, 19), space)).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('rejects a non-working day (Sunday) regardless of the time', () => {
    expect(validateWorkingHours(at(SUN, 10), at(SUN, 11), space)).toBe('NOT_A_WORKING_DAY');
  });

  it('honours a custom working-hours window', () => {
    const wide = { workingDays: [0, 1, 2, 3, 4, 5, 6], openingTime: '08:00', closingTime: '20:00' };
    expect(validateWorkingHours(at(SUN, 8), at(SUN, 20), wide)).toBeNull();
    expect(validateWorkingHours(at(SUN, 7), at(SUN, 9), wide)).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('falls back to Mon–Fri / 09:00–18:00 when the space omits config', () => {
    expect(validateWorkingHours(at(THU, 9), at(THU, 10), {})).toBeNull();
    expect(validateWorkingHours(at(SUN, 10), at(SUN, 11), {})).toBe('NOT_A_WORKING_DAY');
  });
});

describe('occupiedIntervals', () => {
  it('an HOUR booking occupies only its minute window on its day', () => {
    const out = occupiedIntervals('HOUR', at(THU, 9), at(THU, 11));
    expect(out).toEqual([{ date: THU, start: 540, end: 660 }]);
  });

  it('a HALF_DAY booking occupies only its minute window', () => {
    const out = occupiedIntervals('HALF_DAY', at(THU, 9), at(THU, 13));
    expect(out).toEqual([{ date: THU, start: 540, end: 780 }]);
  });

  it('a DAY booking occupies the whole calendar day', () => {
    const out = occupiedIntervals('DAY', at(THU, 9), at(THU, 17));
    expect(out).toEqual([{ date: THU, start: 0, end: 1440 }]);
  });

  it('a multi-day span occupies every covered day in full', () => {
    const out = occupiedIntervals('DAY', at('2026-01-01', 9), at('2026-01-03', 17));
    expect(out.map((i) => i.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(out.every((i) => i.start === 0 && i.end === 1440)).toBe(true);
  });

  it('a zero-length or inverted window yields no interval', () => {
    expect(occupiedIntervals('HOUR', at(THU, 9), at(THU, 9))).toEqual([]);
    expect(occupiedIntervals('DAY', at(THU, 11), at(THU, 9))).toEqual([]);
  });
});
