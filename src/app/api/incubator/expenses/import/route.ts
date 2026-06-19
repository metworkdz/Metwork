/**
 * POST /api/incubator/expenses/import
 *
 * Body: { rows: { date, title, description, amount }[] }
 *
 * Validates and bulk-inserts expense rows. Returns an import summary.
 * Rows with invalid data are skipped, not rejected.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rowSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title:       z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  amount:      z.number().int().min(1),
  category:    z.string().max(80).optional().nullable(),
});

const bodySchema = z.object({
  rows: z.array(z.unknown()).max(5000),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  // Rate limit: a bulk import is a heavy single-document write (up to 5000 rows).
  // 30/hour per incubator is generous for legitimate batch imports while
  // capping a compromised/runaway client from flooding the books.
  if (!(await checkRateLimitDistributed(`expenses-import:inc:${inc.id}`, 30, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many imports in a short period. Please wait a few minutes.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = bodySchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();

  let imported = 0;
  let skipped  = 0;
  const errors: { row: number; reason: string }[] = [];

  await db.update((d) => {
    if (!Array.isArray(d.expenses)) d.expenses = [];

    input.rows.forEach((raw, idx) => {
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        errors.push({ row: idx + 1, reason: parsed.error.issues[0]?.message ?? 'Invalid row' });
        return;
      }
      const r = parsed.data;
      d.expenses.push({
        id:          randomUUID(),
        incubatorId: inc.id,
        date:        r.date,
        title:       r.title.trim(),
        description: r.description ?? null,
        amount:      r.amount,
        category:    r.category ?? null,
        createdAt:   now,
        updatedAt:   now,
      });
      imported++;
    });
  });

  return json({ imported, skipped, errors, batchId });
}
