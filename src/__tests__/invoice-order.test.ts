import { describe, it, expect } from 'vitest';
import { compareByInvoiceDate, sortByInvoiceDate } from '@/lib/invoice-order';

const row = (number: string, issuedAt: string, seq: number, createdAt = '2026-11-03T10:00:00.000Z', year = 2026) =>
  ({ number, issuedAt, seq, year, createdAt });

describe('invoice order: newest date first, oldest last', () => {
  it('orders by the printed date, whatever the creation order', () => {
    const rows = [
      row('01', '2026-07-05T12:00:00.000Z', 1),
      row('02', '2026-09-20T12:00:00.000Z', 2, '2026-11-03T11:00:00.000Z'), // backdated, created last
      row('03', '2026-11-03T09:00:00.000Z', 3),
    ];
    expect(sortByInvoiceDate(rows).map((r) => r.number)).toEqual(['03', '02', '01']);
  });

  it('a backdated document and one issued the same day sort by number, not by clock time', () => {
    // 12:00 UTC (stored for a chosen past day) vs 08:15 UTC (real moment today)
    const a = row('07', '2026-11-03T12:00:00.000Z', 7);
    const b = row('08', '2026-11-03T08:15:00.000Z', 8);
    expect(sortByInvoiceDate([a, b]).map((r) => r.number)).toEqual(['08', '07']);
    expect(compareByInvoiceDate(b, a)).toBeLessThan(0);
  });

  it('breaks full ties by latest creation first, and across years by the later year', () => {
    const x = row('05', '2026-01-10T12:00:00.000Z', 5, '2026-02-01T00:00:00.000Z');
    const y = row('05', '2026-01-10T12:00:00.000Z', 5, '2026-02-02T00:00:00.000Z');
    expect(sortByInvoiceDate([x, y])).toEqual([y, x]);
    const old = row('09/2025', '2026-01-10T12:00:00.000Z', 9, '2026-02-01T00:00:00.000Z', 2025);
    expect(sortByInvoiceDate([old, x])[0]).toBe(x);
  });

  it('does not mutate its input', () => {
    const rows = [row('a', '2026-01-01T12:00:00.000Z', 1), row('b', '2026-05-01T12:00:00.000Z', 2)];
    const snapshot = [...rows];
    sortByInvoiceDate(rows);
    expect(rows).toEqual(snapshot);
  });
});
