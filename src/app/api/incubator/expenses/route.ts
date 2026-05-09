/**
 * GET  /api/incubator/expenses  — list expenses
 * POST /api/incubator/expenses  — create an expense
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type ExpenseRecord } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  title:       z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  amount:      z.number().int().min(1),
  category:    z.string().max(80).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const url = req.nextUrl;
  const from = url.searchParams.get('from');   // YYYY-MM-DD
  const to   = url.searchParams.get('to');     // YYYY-MM-DD

  const data = await db.read();
  let expenses = (data.expenses ?? []).filter((e) => e.incubatorId === inc.id);

  if (from) expenses = expenses.filter((e) => e.date >= from);
  if (to)   expenses = expenses.filter((e) => e.date <= to);

  expenses.sort((a, b) => b.date.localeCompare(a.date));
  return json({ items: expenses, total: expenses.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();
  const record = await db.update<ExpenseRecord>((d) => {
    if (!Array.isArray(d.expenses)) d.expenses = [];
    const expense: ExpenseRecord = {
      id:          randomUUID(),
      incubatorId: inc.id,
      date:        input.date,
      title:       input.title.trim(),
      description: input.description ?? null,
      amount:      input.amount,
      category:    input.category ?? null,
      createdAt:   now,
      updatedAt:   now,
    };
    d.expenses.push(expense);
    return expense;
  });

  return json(record, { status: 201 });
}
