/**
 * POST /api/promo-codes/validate
 *
 * Validates a promo code without consuming it.  Use this to show the
 * discount preview in the checkout UI before the user confirms.
 *
 * Body:  { code: string }
 * 200:   { valid: true,  discountPercent: number, appliesTo: string }
 * 200:   { valid: false, reason: string }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { validatePromoCode } from '@/server/promo-codes/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  code: z.string().min(1).max(64),
});

const REASON_MESSAGES: Record<string, string> = {
  NOT_FOUND:    'Promo code not found',
  INACTIVE:     'Promo code is no longer active',
  EXPIRED:      'Promo code has expired',
  LIMIT_REACHED: 'Promo code has reached its usage limit',
};

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await validatePromoCode(input.code);

  if (!result.valid) {
    return json({
      valid: false,
      reason: result.reason,
      message: REASON_MESSAGES[result.reason] ?? 'Invalid promo code',
    });
  }

  return json({
    valid: true,
    discountPercent: result.discountPercent,
    appliesTo: result.promoCode.appliesTo,
    message: `${result.discountPercent}% discount applied`,
  });
}
