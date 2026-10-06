/**
 * What an incubator has earned and spent — the one place that answers it.
 *
 * Money reaches an incubator by two routes, and the analytics page used to see
 * only the second:
 *
 *   1. PLATFORM BOOKINGS — spaces, programs and events paid for (or recorded)
 *      through Metwork. These are `BookingRecord`s; nothing ever copied them
 *      into the income ledger.
 *   2. THE INCOME LEDGER — operations the host typed in or imported from a CSV.
 *
 * A host whose revenue comes through bookings therefore saw 0 everywhere. Both
 * routes are combined here, once, so the analytics page and the dashboard cards
 * cannot disagree.
 *
 * Two rules keep the sum honest:
 *   - which bookings count is `bookingCountsAsRevenue` — the rule the Revenue
 *     page already uses — so an unpaid intent or a cancelled booking is never
 *     income;
 *   - a ledger row that points at a booking (`income.bookingId`) STANDS IN for
 *     that booking, which is then skipped, so one sale is never counted twice.
 *
 * Dates are plain `YYYY-MM-DD` strings and all arithmetic is in UTC. The old
 * code built `Date`s at local midnight and read them back with `toISOString`,
 * which shifts a day (and, on the first of a month, a whole month) for any
 * server east of UTC.
 */
import type { BookingRecord, IncomeRecord, IncubatorRecord } from '@/server/db/store';
import { bookingCountsAsRevenue } from '@/server/bookings/status';

type Store = {
  income?: IncomeRecord[];
  expenses?: Array<{ incubatorId: string | null; date: string; amount: number }>;
  bookings?: BookingRecord[];
  spaces?: Array<{ id: string; incubatorId: string }>;
  programs?: Array<{ id: string; incubatorId: string | null }>;
  events?: Array<{ id: string; incubatorId: string }>;
};

export type IncomeSource = 'BOOKING' | 'LEDGER';

export interface IncomeRow {
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  /** What it was for — a space / program / event name, or the ledger's service name. */
  label: string;
  source: IncomeSource;
  /** Platform fee frozen on the booking at settlement. Always 0 for a ledger row. */
  fee: number;
}

/** The date a booking's money is recognised on: when it was made. Same as the Revenue page. */
export function bookingDate(b: Pick<BookingRecord, 'createdAt'>): string {
  return b.createdAt.slice(0, 10);
}

/** Bookings on this incubator's own spaces, programs and events that count as revenue. */
export function incubatorRevenueBookings(data: Store, incubatorId: string): BookingRecord[] {
  const spaces = new Set((data.spaces ?? []).filter((s) => s.incubatorId === incubatorId).map((s) => s.id));
  const programs = new Set((data.programs ?? []).filter((p) => p.incubatorId === incubatorId).map((p) => p.id));
  const events = new Set((data.events ?? []).filter((e) => e.incubatorId === incubatorId).map((e) => e.id));
  return (data.bookings ?? []).filter(
    (b) =>
      bookingCountsAsRevenue(b) &&
      ((b.itemKind === 'SPACE' && spaces.has(b.itemId)) ||
        (b.itemKind === 'PROGRAM' && programs.has(b.itemId)) ||
        (b.itemKind === 'EVENT' && events.has(b.itemId))),
  );
}

/** Every income event for the incubator, bookings and ledger together, undated-filtered. */
export function incubatorIncomeRows(data: Store, inc: Pick<IncubatorRecord, 'id'>): IncomeRow[] {
  const ledger = (data.income ?? []).filter((o) => o.incubatorId === inc.id);
  // A ledger row that names a booking stands in for it.
  const covered = new Set(ledger.map((o) => o.bookingId).filter((id): id is string => !!id));

  const rows: IncomeRow[] = ledger.map((o) => ({
    date: o.date,
    amount: o.amount,
    label: o.serviceName,
    source: 'LEDGER' as const,
    fee: 0,
  }));

  for (const b of incubatorRevenueBookings(data, inc.id)) {
    if (covered.has(b.id)) continue;
    rows.push({
      date: bookingDate(b),
      amount: b.totalAmount,
      label: b.itemName,
      source: 'BOOKING',
      // The fee that actually moved through the wallet. Not estimated: a manual or
      // wallet-paid booking never had one deducted, and inventing one would put a
      // cost in the figures that no ledger entry backs.
      fee: b.commissionAmount ?? 0,
    });
  }
  return rows;
}

export function incubatorExpenseRows(data: Store, inc: Pick<IncubatorRecord, 'id'>): Array<{ date: string; amount: number }> {
  return (data.expenses ?? [])
    .filter((e) => e.incubatorId === inc.id)
    .map((e) => ({ date: e.date, amount: e.amount }));
}

/** Income recognised in one calendar month (`YYYY-MM`) — what the dashboard calls MTD / MRR. */
export function incubatorMonthIncome(data: Store, inc: Pick<IncubatorRecord, 'id'>, month: string): number {
  return incubatorIncomeRows(data, inc)
    .filter((r) => r.date.startsWith(month))
    .reduce((s, r) => s + r.amount, 0);
}

/** Revenue-counting bookings made in one calendar month (`YYYY-MM`). */
export function incubatorMonthBookingCount(data: Store, incubatorId: string, month: string): number {
  return incubatorRevenueBookings(data, incubatorId).filter((b) => bookingDate(b).startsWith(month)).length;
}

/* ───────────────────────── time buckets (UTC) ───────────────────────── */

export type Grain = 'day' | 'week' | 'month';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The bucket a `YYYY-MM-DD` date falls in: the day, the Monday of its week, or `YYYY-MM`. */
export function bucketKey(date: string, grain: Grain): string {
  if (grain === 'day') return date;
  if (grain === 'month') return date.slice(0, 7);
  const d = utc(date);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return iso(d);
}

/** Every bucket key from `from` to `to`, inclusive and in order. */
export function bucketRange(from: string, to: string, grain: Grain): string[] {
  const out: string[] = [];
  let cur = bucketKey(from, grain);
  const last = bucketKey(to, grain);
  // The cursor is always a bucket key, so stepping it by one bucket cannot skip or repeat one.
  for (let guard = 0; cur <= last && guard < 5_000; guard++) {
    out.push(cur);
    if (grain === 'day') {
      const d = utc(cur); d.setUTCDate(d.getUTCDate() + 1); cur = iso(d);
    } else if (grain === 'week') {
      const d = utc(cur); d.setUTCDate(d.getUTCDate() + 7); cur = iso(d);
    } else {
      const [y, m] = cur.split('-').map(Number) as [number, number];
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  }
  return out;
}
