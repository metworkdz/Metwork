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
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { ensurePromoCodesSeeded } from '@/server/promo-codes/service';
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
  const data = await db.read();
  const codes = data.promoCodes ?? [];
  const now   = new Date().toISOString();

  const promoCode = codes.find(
    (c) => c.code === input.code.toUpperCase().trim() && c.isActive,
  );

  if (!promoCode) {
    return json({ valid: false, error: 'Invalid promo code' });
  }
  if (promoCode.expiresAt && promoCode.expiresAt < now) {
    return json({ valid: false, error: 'Promo code has expired' });
  }
  if (promoCode.usageLimit !== null && promoCode.usedCount >= promoCode.usageLimit) {
    return json({ valid: false, error: 'Promo code usage limit reached' });
  }

  // All current promo codes use a percentage discount
  const discountAmount = Math.round(input.originalAmount * (promoCode.discountPercent / 100));
  const finalAmount = Math.max(0, input.originalAmount - discountAmount);

  return json({
    valid:          true,
    code:           promoCode.code,
    discountAmount,
    finalAmount,
    discountType:   'PERCENTAGE',
    discountValue:  promoCode.discountPercent,
  });
}
