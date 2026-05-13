/**
 * GET  /api/admin/partners   — list all partner enrolments
 * POST /api/admin/partners   — enroll a space in the Partner Program
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { enrollSpace, listPartners } from '@/server/network/partner-service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enrollSchema = z.object({
  spaceId:                    z.string().uuid('spaceId must be a UUID'),
  offerDiscountedMemberships: z.boolean().optional(),
  discountPercentage:         z.number().int().min(1).max(99).optional(),
  acceptNetworkPasses:        z.boolean().optional(),
  networkPayoutRate:          z.number().int().min(0).optional(),
  maxNetworkUsersPerDay:      z.number().int().min(1).nullable().optional(),
  maxDiscountedMembers:       z.number().int().min(1).nullable().optional(),
});

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const items = await listPartners();
  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = enrollSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const partner = await enrollSpace(
      input,
      guard.user.id,
      guard.user.email,
    );
    return json({ partner }, { status: 201 });
  } catch (err) {
    console.error('[partner-route]', err);
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not found')) return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
    return jsonError(400, 'ENROLL_FAILED', 'An unexpected error occurred');
  }
}
