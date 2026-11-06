import { describe, it, expect } from 'vitest';
import { algiersToday, checkConversionDay, isValidDay, issuedAtForDay } from '@/lib/invoice-date';

describe('lib/invoice-date', () => {
  it('today is Algeria’s day, an hour ahead of UTC', () => {
    expect(algiersToday(new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
    expect(algiersToday(new Date('2026-12-31T23:01:00Z'))).toBe('2027-01-01');
  });
  it('rejects impossible days', () => {
    expect(isValidDay('2026-02-29')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('26-1-1')).toBe(false);
  });
  it('bounds: the source’s printed day to today', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    const src = '2026-10-17T23:30:00.000Z'; // prints 17/10/2026
    expect(checkConversionDay('2026-10-16', src, now)).toBe('BEFORE_SOURCE');
    expect(checkConversionDay('2026-10-17', src, now)).toBeNull();
    expect(checkConversionDay('2026-11-01', src, now)).toBeNull();
    expect(checkConversionDay('2026-11-02', src, now)).toBe('IN_FUTURE');
  });
  it('stores today as the real moment, any other day at noon UTC', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    expect(issuedAtForDay('2026-11-01', now)).toBe(now.toISOString());
    expect(issuedAtForDay('2026-10-20', now)).toBe('2026-10-20T12:00:00.000Z');
  });
});
