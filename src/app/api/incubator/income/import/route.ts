/**
 * POST /api/incubator/income/import
 *
 * Body: { rows: { date, clientName, serviceName, amount, paymentMethod? }[], clientReference? }
 *
 * For each row: find-or-create a client + service by name, then create an
 * IncomeRecord linked to both. Invalid rows are skipped with a summary.
 *
 * Idempotent on `clientReference`: a retried upload (same key) replays the
 * original batch instead of duplicating rows. See `import-service.ts`.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { importIncomeRows } from '@/server/incubator/import-service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  rows: z.array(z.unknown()).max(5000),
  /** Idempotency key — the same upload replays instead of double-importing. */
  clientReference: z.string().min(8).max(128).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  // Rate limit: a bulk import is a heavy single-document write (up to 5000 rows).
  // 30/hour per incubator is generous for legitimate batch imports while
  // capping a compromised/runaway client from flooding the books.
  if (!(await checkRateLimitDistributed(`income-import:inc:${inc.id}`, 30, 60 * 60_000))) {
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

  const summary = await importIncomeRows(inc.id, input.rows, input.clientReference);
  return json(summary);
}
