import { describe, it, expect } from 'vitest';
import { isConsultationRefundWindowOpen, consultationRefundDeadlineMs } from '@/lib/refund-window';

const H = 3_600_000;
const start = Date.parse('2026-11-10T14:00:00+01:00');

describe('consultation refund window', () => {
  const b = { status: 'READY', scheduledAt: new Date(start).toISOString() };

  it('is open more than 24h before the session', () => {
    expect(isConsultationRefundWindowOpen(b, start - 25 * H)).toBe(true);
    expect(isConsultationRefundWindowOpen(b, start - 24 * H)).toBe(true); // exactly 24h still ok
  });
  it('closes inside the last 24h, including the day of the session', () => {
    expect(isConsultationRefundWindowOpen(b, start - 24 * H + 1000)).toBe(false);
    expect(isConsultationRefundWindowOpen(b, start - 2 * H)).toBe(false);
  });
  it('is closed once the session started or finished', () => {
    expect(isConsultationRefundWindowOpen(b, start + H)).toBe(false);
    expect(isConsultationRefundWindowOpen({ ...b, status: 'COMPLETED' }, start - 100 * H)).toBe(false);
  });
  it('falls back to date + time in Algiers wall time (UTC+1)', () => {
    const legacy = { status: 'CONFIRMED', consultationDate: '2026-11-10', consultationTime: '14:00' };
    expect(consultationRefundDeadlineMs(legacy)).toBe(start - 24 * H);
  });
});
