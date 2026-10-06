/**
 * GET /api/incubator/analytics
 *
 * Query params:
 *   from  — YYYY-MM-DD (default: first day of current month)
 *   to    — YYYY-MM-DD (default: today)
 *   grain — 'day' | 'week' | 'month' (default: 'month')
 *
 * Financial analytics for the signed-in incubator over the given period.
 *
 * Income is the platform bookings on the incubator's own spaces, programs and
 * events PLUS the manual income ledger — see `@/server/incubator/finance` for why
 * both are needed and how double counting is avoided. This endpoint used to read
 * the ledger alone, which is why it showed 0 for anyone whose revenue came
 * through bookings.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import {
  bucketKey,
  bucketRange,
  incubatorExpenseRows,
  incubatorIncomeRows,
  incubatorMonthIncome,
} from '@/server/incubator/finance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A real calendar date, not just something shaped like one ("2026-02-31" is refused). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  },
  { message: 'Not a valid date' },
);

const querySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  grain: z.enum(['day', 'week', 'month']).default('month'),
});

/** Enough for several years of months or a year of days; stops a hostile range from looping. */
const MAX_BUCKETS = 800;

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  // By managerId, like the dashboard pages — not by a contact email two accounts could share.
  const inc = (data.incubators ?? []).find((i) => i.managerId === guard.user.id);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const today = new Date().toISOString().slice(0, 10);
  const params = querySchema.safeParse({
    from: req.nextUrl.searchParams.get('from') ?? undefined,
    to: req.nextUrl.searchParams.get('to') ?? undefined,
    grain: req.nextUrl.searchParams.get('grain') ?? undefined,
  });
  if (!params.success) return jsonError(422, 'VALIDATION_ERROR', 'from/to must be real YYYY-MM-DD dates and grain day, week or month');

  const from = params.data.from ?? `${today.slice(0, 7)}-01`;
  const to = params.data.to ?? today;
  const grain = params.data.grain;
  if (from > to) return jsonError(422, 'INVALID_RANGE', '"from" must not be after "to"');

  const buckets = bucketRange(from, to, grain);
  if (buckets.length > MAX_BUCKETS) {
    return jsonError(422, 'RANGE_TOO_LARGE', 'That range has too many periods — choose a coarser grain or a shorter range');
  }

  const inRange = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= from && r.date <= to);
  const incomeRows = inRange(incubatorIncomeRows(data, inc));
  const expenseRows = inRange(incubatorExpenseRows(data, inc));

  const sum = (rows: Array<{ amount: number }>) => rows.reduce((s, r) => s + r.amount, 0);
  const totalIncome = sum(incomeRows);
  const totalExpenses = sum(expenseRows);
  const totalFees = incomeRows.reduce((s, r) => s + r.fee, 0);
  const netProfit = totalIncome - totalExpenses - totalFees;

  // Where the income came from, so a host can see bookings and the ledger are both in the figure.
  const incomeFromBookings = sum(incomeRows.filter((r) => r.source === 'BOOKING'));
  const bookingCount = incomeRows.filter((r) => r.source === 'BOOKING').length;

  // MRR — income recognised in the current calendar month, whatever range is on screen.
  const mrr = incubatorMonthIncome(data, inc, today.slice(0, 7));

  const byLabel = new Map<string, number>();
  for (const r of incomeRows) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + r.amount);
  const revenueByService = [...byLabel.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const income = new Map(buckets.map((b) => [b, 0]));
  const expenses = new Map(buckets.map((b) => [b, 0]));
  const fees = new Map(buckets.map((b) => [b, 0]));
  for (const r of incomeRows) {
    const k = bucketKey(r.date, grain);
    income.set(k, (income.get(k) ?? 0) + r.amount);
    fees.set(k, (fees.get(k) ?? 0) + r.fee);
  }
  for (const r of expenseRows) {
    const k = bucketKey(r.date, grain);
    expenses.set(k, (expenses.get(k) ?? 0) + r.amount);
  }

  const trend = buckets.map((b) => ({
    period: b,
    income: income.get(b) ?? 0,
    expenses: expenses.get(b) ?? 0,
    fees: fees.get(b) ?? 0,
    net: (income.get(b) ?? 0) - (expenses.get(b) ?? 0) - (fees.get(b) ?? 0),
  }));

  return json({
    from,
    to,
    grain,
    totalIncome,
    totalExpenses,
    totalFees,
    netProfit,
    mrr,
    bookingCount,
    incomeFromBookings,
    incomeFromLedger: totalIncome - incomeFromBookings,
    revenueByService,
    trend,
  });
}
