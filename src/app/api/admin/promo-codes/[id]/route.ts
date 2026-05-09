/**
 * PATCH /api/admin/promo-codes/:id  — update a promo code
 * DELETE is intentionally omitted — deactivate via isActive: false instead.
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { updatePromoCode } from '@/server/promo-codes/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  discountPercent: z.number().int().min(1).max(100).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;
  if (guard.user.role !== 'ADMIN') return jsonError(403, 'FORBIDDEN', 'Admin access required');

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = patchSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await updatePromoCode(id, input);
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Promo code not found');

  return json(updated);
}
