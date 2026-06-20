/**
 * PATCH  /api/admin/partners/[id]   — update an incubator's partner settings
 * DELETE /api/admin/partners/[id]   — unenroll an incubator
 *
 * `id` is the IncubatorRecord.id (per-incubator Partner Program).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import {
  updateIncubatorPartnerSettings,
  unenrollIncubator,
} from '@/server/network/partner-incubator-service';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  isActive:                   z.boolean().optional(),
  offerDiscountedMemberships: z.boolean().optional(),
  discountPercentage:         z.number().int().min(1).max(99).optional(),
  acceptNetworkPasses:        z.boolean().optional(),
  networkPayoutRate:          z.number().int().min(0).optional(),
  maxNetworkUsersPerDay:      z.number().int().min(1).nullable().optional(),
  maxDiscountedMembers:       z.number().int().min(1).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

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
    const partner = await updateIncubatorPartnerSettings(id, input, guard.user.id, guard.user.email);
    return json({ partner });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Update failed';
    if (msg.includes('no partner record')) return jsonError(404, 'PARTNER_NOT_FOUND', msg);
    return jsonError(400, 'UPDATE_FAILED', msg);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  await unenrollIncubator(id, guard.user.id, guard.user.email);
  return noContent();
}
