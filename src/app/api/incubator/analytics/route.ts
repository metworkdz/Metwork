/**
 * GET /api/incubator/analytics
 *
 * Query params:
 *   from  — YYYY-MM-DD (default: first day of current month)
 *   to    — YYYY-MM-DD (default: today)
 *   grain — 'day' | 'week' | 'month' (default: 'month')
 *
 * Returns financial analytics for the given period.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { bookingCountsAsRevenue } from '@/server/bookings/status';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toDate(s: string): Date { return new Date(`${s}T00:00:00`); }

function dateRange(from: string, to: string, grain: 'day' | 'week' | 'month'): string[] {
  const result: string[] = [];
  const cur = toDate(from);
  const end = toDate(to);
  while (cur <= end) {
    if (grain === 'day') {
      result.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    } else if (grain === 'week') {
      result.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 7);
    } else {
      result.push(cur.toISOString().slice(0, 7)); // YYYY-MM
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return [...new Set(result)];
}

function bucketKey(date: string, grain: 'day' | 'week' | 'month'): string {
  if (grain === 'month') return date.slice(0, 7);
  if (grain === 'week') {
    // Week key: Monday of the week
    const d = toDate(date);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  return date;
}

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'TRAINER']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const url   = req.nextUrl;
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  const from  = url.searchParams.get('from')  ?? firstOfMonth;
  const to    = url.searchParams.get('to')    ?? today;
  const grain = (url.searchParams.get('grain') ?? 'month') as 'day' | 'week' | 'month';

  const data = await db.read();

  const incomeRows  = (data.income   ?? []).filter((o) => o.incubatorId === inc.id && o.date >= from && o.date <= to);
  const expenseRows = (data.expenses ?? []).filter((e) => e.incubatorId === inc.id && e.date >= from && e.date <= to);

  // Aggregations
  const totalIncome   = incomeRows.reduce((s, o) => s + o.amount, 0);
  const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0);
  const netProfit     = totalIncome - totalExpenses;

  // MRR — income in the current calendar month
  const currentMonth = today.slice(0, 7);
  const mrr = (data.income ?? [])
    .filter((o) => o.incubatorId === inc.id && o.date.startsWith(currentMonth))
    .reduce((s, o) => s + o.amount, 0);

  // Revenue by service
  const byService: Record<string, number> = {};
  for (const o of incomeRows) {
    byService[o.serviceName] = (byService[o.serviceName] ?? 0) + o.amount;
  }
  const revenueByService = Object.entries(byService)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Time-series buckets
  const buckets = dateRange(from, to, grain);
  const incomeByBucket: Record<string, number>  = {};
  const expenseByBucket: Record<string, number> = {};
  for (const b of buckets) { incomeByBucket[b] = 0; expenseByBucket[b] = 0; }

  for (const o of incomeRows) {
    const k = bucketKey(o.date, grain);
    if (k in incomeByBucket) incomeByBucket[k] = (incomeByBucket[k] ?? 0) + o.amount;
  }
  for (const e of expenseRows) {
    const k = bucketKey(e.date, grain);
    if (k in expenseByBucket) expenseByBucket[k] = (expenseByBucket[k] ?? 0) + e.amount;
  }

  const trend = buckets.map((b) => ({
    period:   b,
    income:   incomeByBucket[b] ?? 0,
    expenses: expenseByBucket[b] ?? 0,
    net:      (incomeByBucket[b] ?? 0) - (expenseByBucket[b] ?? 0),
  }));

  // Total booking count for this incubator (from platform bookings)
  const spaceIds   = new Set((data.spaces   ?? []).filter((s) => s.incubatorId === inc.id).map((s) => s.id));
  const programIds = new Set((data.programs ?? []).filter((p) => p.incubatorId === inc.id).map((p) => p.id));
  const eventIds   = new Set((data.events   ?? []).filter((e) => e.incubatorId === inc.id).map((e) => e.id));
  // Awaiting-payment intents are excluded from analytics, matching every other
  // financial surface (shared rule).
  const bookingCount = data.bookings.filter((b) => {
    if (!bookingCountsAsRevenue(b)) return false;
    if (b.itemKind === 'SPACE'   && spaceIds.has(b.itemId))   return true;
    if (b.itemKind === 'PROGRAM' && programIds.has(b.itemId)) return true;
    if (b.itemKind === 'EVENT'   && eventIds.has(b.itemId))   return true;
    return false;
  }).length;

  return json({
    from,
    to,
    grain,
    totalIncome,
    totalExpenses,
    netProfit,
    mrr,
    bookingCount,
    revenueByService,
    trend,
  });
}
