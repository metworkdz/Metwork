/**
 * PATCH  /api/admin/promo-codes/:id  — edit a promo code (name, discount, scope, limit, expiry, active)
 * DELETE /api/admin/promo-codes/:id  — permanently delete it, freeing the name for reuse
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { updatePromoCode, deletePromoCode, PromoCodeExistsError } from '@/server/promo-codes/service';
import { appendAuditLog } from '@/server/audit/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/i, 'Code may only contain letters, digits, hyphens, and underscores')
    .optional(),
  appliesTo: z.enum(['ALL', 'MEMBERSHIP', 'SPACE', 'CONSULTATION']).optional(),
  isActive: z.boolean().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  discountPercent: z.number().int().min(1).max(100).optional(),
});

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
    input = patchSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  let updated;
  try {
    updated = await updatePromoCode(id, input);
  } catch (err) {
    if (err instanceof PromoCodeExistsError) {
      return jsonError(
        409,
        err.inactive ? 'PROMO_CODE_EXISTS_INACTIVE' : 'PROMO_CODE_EXISTS',
        err.inactive
          ? 'A deactivated promo code already has this name. Reactivate it, rename it, or delete it to free the name.'
          : 'A promo code with this name already exists',
      );
    }
    throw err;
  }
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Promo code not found');

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'PROMO_CODE_UPDATED',
    targetType: 'promo_code',
    targetId: updated.id,
    details: { code: updated.code, changed: Object.keys(input) },
  });

  return json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const removed = await deletePromoCode(id);
  if (!removed) return jsonError(404, 'NOT_FOUND', 'Promo code not found');

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'PROMO_CODE_DELETED',
    targetType: 'promo_code',
    targetId: removed.id,
    details: { code: removed.code, usedCount: removed.usedCount ?? 0 },
  });

  return json({ deleted: true, id: removed.id, code: removed.code });
}
