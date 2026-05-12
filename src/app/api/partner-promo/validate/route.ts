/**
 * POST /api/partner-promo/validate
 *
 * Check whether a partner membership promo code is valid (unused, not expired,
 * partner active). Does NOT consume the code.
 *
 * Available to any authenticated user.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { validatePromoCode } from '@/server/network/partner-promo-service';
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

  const result = await validatePromoCode(input.code);

  if (!result.valid) {
    return json({ valid: false, error: result.error ?? 'Invalid code' }, { status: 422 });
  }

  return json({
    valid: true,
    discountPercentage: result.discountPercentage,
    membershipTier: result.membershipTier,
  });
}
