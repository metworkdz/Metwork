/**
 * GET  /api/admin/perks/:id/codes  — list pool entries with assignee info
 * POST /api/admin/perks/:id/codes  — bulk-add newline-separated codes
 *
 * Admin-only endpoint. CODE_POOL perks only (POST rejects otherwise).
 * A successful add clears lowStockNotifiedAt so the next depletion cycle
 * can trigger the low-stock email again.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { addPoolCodes, listPoolEntries } from '@/server/perks/service';
import { addCodesSchema } from '@/server/perks/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const entries = await listPoolEntries(id);
  if (!entries) return jsonError(404, 'NOT_FOUND', 'Perk not found');

  return json({ items: entries, total: entries.length });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = addCodesSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const result = await addPoolCodes(id, input.codes);
    return json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'PERK_NOT_FOUND') {
        return jsonError(404, 'NOT_FOUND', 'Perk not found');
      }
      if (err.message === 'NOT_CODE_POOL') {
        return jsonError(422, 'NOT_CODE_POOL', 'Codes can only be added to CODE_POOL perks');
      }
      if (err.message === 'NO_VALID_CODES') {
        return jsonError(422, 'NO_VALID_CODES', 'No valid codes found in the payload');
      }
    }
    throw err;
  }
}
