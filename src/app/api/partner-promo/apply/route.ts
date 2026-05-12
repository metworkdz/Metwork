/**
 * POST /api/partner-promo/apply
 *
 * Apply a partner membership promo code for the authenticated user.
 * Consumes the code, creates/upgrades the membership, and records
 * the partner affiliation.
 *
 * Body: { code: string }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { applyPromoCode } from '@/server/network/partner-promo-service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  code: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  try {
    const result = await applyPromoCode(input.code, guard.user.id);
    return json({
      success: true,
      membership: result.membership,
      discountPercentage: result.discountPercentage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not apply promo code';
    if (msg.includes('not found') || msg.includes('expired') || msg.includes('already used')) {
      return jsonError(422, 'PROMO_INVALID', msg);
    }
    if (msg.includes('already affiliated')) {
      return jsonError(409, 'ALREADY_AFFILIATED', msg);
    }
    if (msg.includes('maximum discounted members')) {
      return jsonError(422, 'PARTNER_CAP_REACHED', msg);
    }
    return jsonError(500, 'APPLY_FAILED', msg);
  }
}
