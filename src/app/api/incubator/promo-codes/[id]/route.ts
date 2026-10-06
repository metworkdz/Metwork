/**
 * PATCH  /api/incubator/promo-codes/:id  — edit one of this incubator's codes
 * DELETE /api/incubator/promo-codes/:id  — delete it (frees the name)
 *
 * A code that belongs to another incubator, or to the platform, answers exactly
 * like one that does not exist: 404, same body.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import {
  deleteIncubatorPromoCode,
  findManagedIncubatorId,
  PromoScopeError,
  updateIncubatorPromoCode,
} from '@/server/promo-codes/incubator-service';
import { PromoCodeExistsError } from '@/server/promo-codes/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { conflictResponse, scopeErrorResponse } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idList = z.array(z.string().min(1).max(100)).max(200);
const partialScope = z.object({ programIds: idList.optional(), spaceIds: idList.optional() }).strict();

const patchSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/i, 'Code may only contain letters, digits, hyphens, and underscores')
      .optional(),
    discountPercent: z.number().int().min(1).max(100).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
    programIds: idList.optional(),
    spaceIds: idList.optional(),
    attach: partialScope.optional(),
    detach: partialScope.optional(),
  })
  .strict()
  .refine(
    (v) => !((v.programIds || v.spaceIds) && (v.attach || v.detach)),
    { message: 'Replace the target list or attach/detach — not both in one request' },
  );

const NOT_FOUND = () => jsonError(404, 'NOT_FOUND', 'Promo code not found');

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const incubatorId = await findManagedIncubatorId(guard.user.id);
  if (!incubatorId) return NOT_FOUND();

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const updated = await updateIncubatorPromoCode(incubatorId, id, input);
    if (!updated) return NOT_FOUND();
    return json(updated);
  } catch (err) {
    if (err instanceof PromoScopeError) return scopeErrorResponse(err);
    if (err instanceof PromoCodeExistsError) return conflictResponse(err);
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const incubatorId = await findManagedIncubatorId(guard.user.id);
  if (!incubatorId) return NOT_FOUND();

  const { id } = await params;
  const removed = await deleteIncubatorPromoCode(incubatorId, id);
  if (!removed) return NOT_FOUND();
  return json({ deleted: true, id: removed.id, code: removed.code });
}
