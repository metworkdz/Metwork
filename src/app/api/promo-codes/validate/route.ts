/**
 * POST /api/promo-codes/validate
 *
 * Validates a promo code and returns the discount info.
 * Used by all booking/payment forms before submission.
 *
 * Body:   { code: string; originalAmount: number }
 * Returns: { valid: true; discountAmount: number; finalAmount: number; code: string }
 *        | { valid: false; error: string }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { ensurePromoCodesSeeded } from '@/server/promo-codes/service';
import { lookupAnyPromoCode } from '@/server/promo-codes/lookup';
import { requireApiSession } from '@/server/auth/api-guards';
import { checkRateLimitDistributed } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  code:           z.string().min(1).max(50),
  originalAmount: z.number().int().min(0),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Maps the unified lookup's reason codes to human-readable error strings.
 * Centralised here so all client-facing copy stays consistent.
 */
function errorMessageForReason(reason: string): string {
  switch (reason) {
    case 'NOT_FOUND':         return 'Invalid promo code';
    case 'INACTIVE':          return 'Promo code is no longer active';
    case 'EXPIRED':           return 'Promo code has expired';
    case 'LIMIT_REACHED':     return 'Promo code usage limit reached';
    case 'ALREADY_USED':      return 'This promo code has already been used';
    case 'PARTNER_INACTIVE':  return 'This promo code is no longer active';
    case 'INVALID_FORMAT':    return 'Invalid promo code';
    default:                  return 'Invalid promo code';
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`promo-validate:${ip}`, 20, 5 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many promo code validation attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return json({ valid: false, error: 'Invalid request body' }); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  await ensurePromoCodesSeeded();

  // Unified lookup: checks the regular promo table first, then partner
  // promo codes. Consumers no longer need to know which system answers.
  const result = await lookupAnyPromoCode(input.code);

  if (result.kind === 'INVALID') {
    return json({ valid: false, error: errorMessageForReason(result.reason) });
  }

  // Both REGULAR and PARTNER kinds expose `discountPercent`. Compute the
  // discount once — pricing math is identical regardless of code type.
  const discountAmount = Math.round(input.originalAmount * (result.discountPercent / 100));
  const finalAmount    = Math.max(0, input.originalAmount - discountAmount);

  return json({
    valid:         true,
    code:          result.code,
    /** Surface the code kind so checkout flows can branch (partner → tie to
     *  membership purchase + partner attribution; regular → multi-use bookings). */
    kind:          result.kind,
    discountAmount,
    finalAmount,
    discountType:  'PERCENTAGE',
    discountValue: result.discountPercent,
  });
}
