/**
 * PATCH /api/admin/perks/:id  — update a perk (active, minTier, threshold, fields)
 * DELETE is intentionally omitted — deactivate via active: false instead.
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { updatePerk } from '@/server/perks/service';
import { patchPerkSchema } from '@/server/perks/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
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
    input = patchPerkSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const updated = await updatePerk(id, input);
    if (!updated) return jsonError(404, 'NOT_FOUND', 'Perk not found');
    return json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'THRESHOLD_NOT_APPLICABLE') {
      return jsonError(
        422,
        'THRESHOLD_NOT_APPLICABLE',
        'lowStockThreshold only applies to CODE_POOL perks',
      );
    }
    throw err;
  }
}
