/**
 * The incubator Analytics page showed 0 because it read only the manual income
 * ledger. Real money arrives as platform BOOKINGS, which nothing ever copied
 * into that ledger. These tests pin the fix from three sides:
 *
 *   - the numbers are right (bookings + ledger, no double counting, the right
 *     bookings, the right period);
 *   - they cannot leak or be forged (another incubator's money, hostile ranges,
 *     the wrong roles);
 *   - they agree with the Revenue page, which already answered "how much did
 *     my bookings bring in" — two pages must never tell two stories.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Actor = { id: string; email: string; role: string };
const hostA: Actor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
const hostB: Actor = { id: 'mgr-b', email: 'b@x.dz', role: 'INCUBATOR' };
let currentUser: Actor | null = hostA;

vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async (roles: string[]) => {
    if (!currentUser) return { ok: false as const, response: new Response('unauthorised', { status: 401 }) };
    if (!roles.includes(currentUser.role)) return { ok: false as const, response: new Response('forbidden', { status: 403 }) };
    return { ok: true as const, user: currentUser };
  }),
}));

import { db } from '@/server/db/store';
import {
  bucketKey,
  bucketRange,
  incubatorIncomeRows,
  incubatorMonthBookingCount,
  incubatorMonthIncome,
} from '@/server/incubator/finance';

const A = 'inc-a';
const B = 'inc-b';
const D = (day: string) => `${day}T10:00:00.000Z`;

const booking = (id: string, over: Record<string, unknown> = {}) => ({
  id, userId: null, source: 'offline', itemKind: 'SPACE', itemId: 'space-a', itemName: 'Open space', vendorName: 'A',
  city: 'Oran', unit: 'DAY', quantity: 1, startsAt: D('2026-03-10'), endsAt: D('2026-03-11'), totalAmount: 5000,
  status: 'CONFIRMED', clientReference: `r-${id}`, transactionId: null, paymentMethod: 'manual',
  createdAt: D('2026-03-10'), updatedAt: D('2026-03-10'), ...over,
}) as never;

const ledger = (id: string, over: Record<string, unknown> = {}) => ({
  id, incubatorId: A, clientId: null, clientName: 'C', serviceName: 'Consulting', serviceId: null, date: '2026-03-12',
  amount: 2000, paymentMethod: 'CASH', notes: null, importBatchId: null, bookingId: null,
  createdAt: D('2026-03-12'), updatedAt: D('2026-03-12'), ...over,
}) as never;

const expense = (id: string, over: Record<string, unknown> = {}) => ({
  id, incubatorId: A, date: '2026-03-15', amount: 1500, category: 'RENT', description: 'x', ...over,
}) as never;

async function seed(): Promise<void> {
  await db.update((d) => {
    d.incubators = [
      { id: A, name: 'A', status: 'ACTIVE', managerId: 'mgr-a', email: 'shared@x.dz', createdAt: D('2026-01-01'), updatedAt: D('2026-01-01') } as never,
      { id: B, name: 'B', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz', createdAt: D('2026-01-01'), updatedAt: D('2026-01-01') } as never,
    ];
    d.spaces = [
      { id: 'space-a', incubatorId: A, name: 'Open space' } as never,
      { id: 'space-b', incubatorId: B, name: 'B room' } as never,
    ];
    d.programs = [{ id: 'prog-a', incubatorId: A, title: 'Bootcamp' } as never, { id: 'prog-mentor', incubatorId: null, title: 'Consultant program' } as never];
    d.events = [{ id: 'ev-a', incubatorId: A, title: 'Demo day' } as never];
    d.income = []; d.expenses = []; d.wallets = []; d.transactions = [];
    d.bookings = [
      booking('b-space', { totalAmount: 5000 }),                                                   // counts
      booking('b-prog', { itemKind: 'PROGRAM', itemId: 'prog-a', itemName: 'Bootcamp', totalAmount: 20000, source: 'online', paymentMethod: 'card', commissionAmount: 1000, createdAt: D('2026-04-02') }),
      booking('b-event', { itemKind: 'EVENT', itemId: 'ev-a', itemName: 'Demo day', totalAmount: 3000, createdAt: D('2026-04-20') }),
      booking('b-cancelled', { status: 'CANCELLED', totalAmount: 99999 }),
      booking('b-unpaid', { status: 'PENDING_PAYMENT', totalAmount: 88888 }),
      booking('b-request', { status: 'AWAITING_APPROVAL', totalAmount: 77777 }),
      booking('b-foreign', { itemId: 'space-b', totalAmount: 55555 }),                             // incubator B's
      booking('b-mentor', { itemKind: 'PROGRAM', itemId: 'prog-mentor', totalAmount: 44444 }),     // consultant's
    ];
    d.income = [ledger('i-1'), ledger('i-foreign', { incubatorId: B, amount: 66666 })];
    d.expenses = [expense('e-1'), expense('e-foreign', { incubatorId: B, amount: 33333 }), expense('e-mentor', { incubatorId: null, amount: 22222 })];
  });
  currentUser = hostA;
}
beforeEach(seed);

const analytics = async (qs = '') => {
  const { GET } = await import('@/app/api/incubator/analytics/route');
  return GET(new NextRequest(`http://localhost/api/incubator/analytics${qs}`));
};
const body = async (qs = '') => (await analytics(qs)).json();
const ALL = '?from=2026-01-01&to=2026-12-31&grain=month';

/* ═══════════════ the reported bug ═══════════════ */

describe('an incubator whose money comes through bookings', () => {
  it('no longer sees 0 — bookings are income', async () => {
    await db.update((d) => { d.income = []; d.expenses = []; });
    const r = await body(ALL);
    expect(r.totalIncome).toBe(5000 + 20000 + 3000);
    expect(r.bookingCount).toBe(3);
    expect(r.totalIncome).toBeGreaterThan(0);
  });

  it('adds the manual ledger on top', async () => {
    const r = await body(ALL);
    expect(r.totalIncome).toBe(5000 + 20000 + 3000 + 2000);
    expect(r.incomeFromBookings).toBe(28000);
    expect(r.incomeFromLedger).toBe(2000);
  });

  it('counts only bookings that hold real money: not cancelled, unpaid or awaiting approval', async () => {
    const r = await body(ALL);
    expect(r.bookingCount).toBe(3);
    expect(r.totalIncome).not.toBeGreaterThanOrEqual(99999);
  });

  it('never includes another incubator\'s or a consultant\'s money', async () => {
    const r = await body(ALL);
    expect(r.totalIncome).toBe(30000);
    expect(r.totalExpenses).toBe(1500);
    expect(JSON.stringify(r)).not.toMatch(/55555|66666|33333|44444|22222/);
  });

  it('net profit is income minus expenses minus platform fees actually deducted', async () => {
    const r = await body(ALL);
    expect(r.totalFees).toBe(1000);
    expect(r.netProfit).toBe(30000 - 1500 - 1000);
  });

  it('invents no fee: a manual or wallet booking without a frozen commission costs nothing', async () => {
    const rows = incubatorIncomeRows((await db.read()) as never, { id: A });
    expect(rows.filter((x) => x.source === 'BOOKING' && x.label !== 'Bootcamp').every((x) => x.fee === 0)).toBe(true);
  });

  it('revenue by service names the spaces, programs and events that earned it', async () => {
    const r = await body(ALL);
    expect(r.revenueByService.map((x: { name: string }) => x.name)).toEqual(['Bootcamp', 'Open space', 'Demo day', 'Consulting']);
    expect(r.revenueByService[0]).toEqual({ name: 'Bootcamp', amount: 20000 });
  });
});

describe('no double counting', () => {
  it('a ledger row that names a booking stands in for it', async () => {
    await db.update((d) => { d.income.push(ledger('i-linked', { bookingId: 'b-space', amount: 5000, serviceName: 'Space rental' })); });
    const r = await body(ALL);
    // b-space (5000) is represented by the ledger row, not added again.
    expect(r.totalIncome).toBe(5000 + 20000 + 3000 + 2000);
    expect(r.bookingCount).toBe(2);
  });

  it('a ledger row linked to ANOTHER booking does not hide this one', async () => {
    await db.update((d) => { d.income.push(ledger('i-other', { bookingId: 'b-foreign', amount: 1 })); });
    expect((await body(ALL)).bookingCount).toBe(3);
  });
});

/* ═══════════════ periods ═══════════════ */

describe('periods', () => {
  it('only counts what falls inside from–to, bookings included (the count used to ignore the range)', async () => {
    const march = await body('?from=2026-03-01&to=2026-03-31&grain=day');
    expect(march.bookingCount).toBe(1);
    expect(march.totalIncome).toBe(5000 + 2000);
    expect(march.totalExpenses).toBe(1500);
    const april = await body('?from=2026-04-01&to=2026-04-30&grain=day');
    expect(april.bookingCount).toBe(2);
    expect(april.totalIncome).toBe(23000);
  });

  it('both ends are inclusive', async () => {
    const r = await body('?from=2026-03-10&to=2026-03-10&grain=day');
    expect(r.totalIncome).toBe(5000);
  });

  it('the trend has one bucket per period, in order, and sums to the totals', async () => {
    const r = await body(ALL);
    expect(r.trend.map((t: { period: string }) => t.period)).toEqual(
      ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'],
    );
    const sum = (k: string) => r.trend.reduce((s: number, t: Record<string, number>) => s + t[k]!, 0);
    expect(sum('income')).toBe(r.totalIncome);
    expect(sum('expenses')).toBe(r.totalExpenses);
    expect(sum('fees')).toBe(r.totalFees);
    expect(sum('net')).toBe(r.netProfit);
    expect(r.trend[2]).toMatchObject({ period: '2026-03', income: 7000, expenses: 1500 });
    expect(r.trend[3]).toMatchObject({ period: '2026-04', income: 23000, fees: 1000 });
  });

  it('weekly buckets start on a Monday', async () => {
    const r = await body('?from=2026-03-09&to=2026-03-22&grain=week');
    expect(r.trend.map((t: { period: string }) => t.period)).toEqual(['2026-03-09', '2026-03-16']);
    // Week of Mon 9 Mar: the booking (Tue 10) + the ledger row (Thu 12) and the expense (Sun 15).
    expect(r.trend[0]).toMatchObject({ income: 7000, expenses: 1500 });
    // Week of Mon 16 Mar: nothing.
    expect(r.trend[1]).toMatchObject({ income: 0, expenses: 0 });
  });

  it('MRR is this calendar month\'s income whatever range is on screen', async () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    await db.update((d) => { d.income.push(ledger('i-now', { date: `${thisMonth}-01`, amount: 4000 })); });
    const r = await body('?from=2020-01-01&to=2020-01-31&grain=month');
    expect(r.totalIncome).toBe(0);
    expect(r.mrr).toBe(4000);
  });
});

describe('the figures are right in any server timezone', () => {
  const original = process.env.TZ;
  afterEach(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });

  it.each(['UTC', 'Africa/Algiers', 'Pacific/Auckland', 'America/Los_Angeles'])('%s', (tz) => {
    process.env.TZ = tz;
    // The old code started a Jan-1 range in December (and a Mon-1 range on Sunday) east of UTC.
    expect(bucketRange('2026-01-01', '2026-03-31', 'month')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(bucketRange('2026-03-01', '2026-03-03', 'day')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(bucketRange('2026-03-09', '2026-03-22', 'week')).toEqual(['2026-03-09', '2026-03-16']);
    expect(bucketKey('2026-03-15', 'week')).toBe('2026-03-09'); // a Sunday belongs to the week that began on the previous Monday
    expect(bucketKey('2026-03-16', 'week')).toBe('2026-03-16');
    expect(bucketRange('2025-11-01', '2026-02-01', 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

/* ═══════════════ isolation, validation, access ═══════════════ */

describe('whose money it is', () => {
  it('another incubator sees only its own', async () => {
    currentUser = hostB;
    const r = await body(ALL);
    expect(r.totalIncome).toBe(55555 + 66666);
    expect(r.totalExpenses).toBe(33333);
    expect(r.revenueByService.map((x: { name: string }) => x.name)).not.toContain('Bootcamp');
  });

  it('the incubator is the one the user MANAGES, not the one sharing a contact email', async () => {
    // Incubator A's contact email is shared@x.dz. An account with that email who manages nothing must get nothing.
    currentUser = { id: 'impostor', email: 'shared@x.dz', role: 'INCUBATOR' };
    expect((await analytics(ALL)).status).toBe(404);
  });

  it('a user who manages no incubator gets a clean 404', async () => {
    currentUser = { id: 'orphan', email: 'o@x.dz', role: 'INCUBATOR' };
    expect((await analytics(ALL)).status).toBe(404);
  });

  it.each([
    ['an admin', { id: 'adm', email: 'adm@x.dz', role: 'ADMIN' }],
    ['an entrepreneur', { id: 'e', email: 'e@x.dz', role: 'ENTREPRENEUR' }],
    ['nobody', null],
  ])('%s is refused', async (_w, user) => {
    currentUser = user;
    expect([401, 403]).toContain((await analytics(ALL)).status);
  });
});

describe('hostile or sloppy parameters', () => {
  it.each([
    ['?from=yesterday'], ['?to=2026-13-01'], ['?from=2026-02-31&to=2026-03-01'], ['?from=2026-3-1'],
    ['?grain=hour'], ['?grain=Month'], ['?from=2026-06-01&to=2026-01-01'],
  ])('%s is a 422, never a crash or a silent default', async (qs) => {
    expect((await analytics(qs)).status).toBe(422);
  });

  it('a range that would need thousands of buckets is refused', async () => {
    const res = await analytics('?from=1900-01-01&to=2100-12-31&grain=day');
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('RANGE_TOO_LARGE');
  });

  it('a multi-year monthly range is fine', async () => {
    expect((await analytics('?from=2020-01-01&to=2026-12-31&grain=month')).status).toBe(200);
  });

  it('defaults to this month, month grain', async () => {
    const r = await body('');
    expect(r.grain).toBe('month');
    expect(r.from).toBe(`${new Date().toISOString().slice(0, 7)}-01`);
    expect(r.trend).toHaveLength(1);
  });

  it('an incubator with no activity gets zeros, not an error', async () => {
    await db.update((d) => { d.bookings = []; d.income = []; d.expenses = []; });
    const r = await body(ALL);
    expect(r).toMatchObject({ totalIncome: 0, totalExpenses: 0, netProfit: 0, bookingCount: 0, totalFees: 0, revenueByService: [] });
  });
});

/* ═══════════════ agrees with the Revenue page ═══════════════ */

describe('analytics and the Revenue page tell the same story', () => {
  it('booking income equals the Revenue page\'s gross, and the booking count its count', async () => {
    const { GET } = await import('@/app/api/incubator/revenue/route');
    const rev = await (await GET()).json();
    const a = await body(ALL);
    expect(a.incomeFromBookings).toBe(rev.totals.gross);
    expect(a.bookingCount).toBe(rev.totals.bookings);
  });

  it('…per month too', async () => {
    const { GET } = await import('@/app/api/incubator/revenue/route');
    const rev = await (await GET()).json();
    const a = await body(ALL);
    for (const b of rev.buckets as Array<{ month: string; gross: number; bookings: number }>) {
      const t = a.trend.find((x: { period: string }) => x.period === b.month);
      // Ledger rows land in the same months here; compare booking-only by removing them.
      const ledgerThatMonth = 2000 * Number(b.month === '2026-03');
      expect(t.income - ledgerThatMonth).toBe(b.gross);
    }
  });
});

/* ═══════════════ the dashboard cards ═══════════════ */

describe('the dashboard\'s monthly cards use the same numbers', () => {
  it('Income (MTD) includes bookings, and the count excludes cancelled / unpaid ones', async () => {
    const data = await db.read();
    expect(incubatorMonthIncome(data as never, { id: A }, '2026-03')).toBe(5000 + 2000);
    expect(incubatorMonthIncome(data as never, { id: A }, '2026-04')).toBe(23000);
    expect(incubatorMonthBookingCount(data as never, A, '2026-03')).toBe(1);
    expect(incubatorMonthBookingCount(data as never, A, '2026-04')).toBe(2);
    expect(incubatorMonthIncome(data as never, { id: A }, '2025-01')).toBe(0);
  });
});
