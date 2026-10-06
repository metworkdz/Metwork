/**
 * GET  /api/incubator/promo-codes  — this incubator's own promo codes (newest first)
 * POST /api/incubator/promo-codes  — create a code scoped to some of its programs/spaces
 *
 * Every program/space id in the body is checked against what THIS incubator
 * owns, server-side (see `@/server/promo-codes/incubator-service`). The body can
 * never name an owner or an `appliesTo` — the schema is strict, so a client that
 * tries gets a validation error rather than a silently-ignored field.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import {
  createIncubatorPromoCode,
  findManagedIncubatorId,
  listIncubatorPromoCodes,
  PromoScopeError,
} from '@/server/promo-codes/incubator-service';
import { PromoCodeExistsError } from '@/server/promo-codes/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idList = z.array(z.string().min(1).max(100)).max(200);

const createSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/i, 'Code may only contain letters, digits, hyphens, and underscores'),
    discountPercent: z.number().int().min(1).max(100),
    expiresAt: z.string().datetime().nullable().default(null),
    usageLimit: z.number().int().min(1).nullable().default(null),
    programIds: idList.default([]),
    spaceIds: idList.default([]),
  })
  .strict();

export function scopeErrorResponse(err: PromoScopeError) {
  return err.reason === 'EMPTY_SCOPE'
    ? jsonError(422, 'PROMO_SCOPE_EMPTY', 'Choose at least one program or space for this code')
    // Same answer whether the id is someone else's or does not exist.
    : jsonError(422, 'PROMO_SCOPE_INVALID', 'One or more selected programs or spaces were not found');
}

export function conflictResponse(err: PromoCodeExistsError) {
  return jsonError(
    409,
    err.inactive ? 'PROMO_CODE_EXISTS_INACTIVE' : 'PROMO_CODE_EXISTS',
    err.inactive
      ? 'One of your deactivated codes already has this name. Reactivate it, rename it, or delete it to free the name.'
      : 'This code name is already in use. Choose another.',
  );
}

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const incubatorId = await findManagedIncubatorId(guard.user.id);
  if (!incubatorId) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const items = await listIncubatorPromoCodes(incubatorId);
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const incubatorId = await findManagedIncubatorId(guard.user.id);
  if (!incubatorId) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const record = await createIncubatorPromoCode(incubatorId, input);
    return json(record, { status: 201 });
  } catch (err) {
    if (err instanceof PromoScopeError) return scopeErrorResponse(err);
    if (err instanceof PromoCodeExistsError) return conflictResponse(err);
    throw err;
  }
}
