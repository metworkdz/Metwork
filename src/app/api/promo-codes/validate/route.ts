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
import { fromZod, json } from '@/server/http/json';
import { ensurePromoCodesSeeded } from '@/server/promo-codes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  code:           z.string().min(1).max(50),
  originalAmount: z.number().int().min(0),
});

export async function POST(req: NextRequest) {
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
  if (promoCode.validUntil && promoCode.validUntil < now) {
    return json({ valid: false, error: 'Promo code has expired' });
  }
  if (promoCode.validFrom > now) {
    return json({ valid: false, error: 'Promo code is not yet active' });
  }
  if (promoCode.maxUses !== null && promoCode.useCount >= promoCode.maxUses) {
    return json({ valid: false, error: 'Promo code usage limit reached' });
  }

  let discountAmount: number;
  if (promoCode.discountType === 'PERCENTAGE') {
    discountAmount = Math.round(input.originalAmount * (promoCode.discountValue / 100));
  } else {
    discountAmount = Math.min(promoCode.discountValue, input.originalAmount);
  }

  const finalAmount = Math.max(0, input.originalAmount - discountAmount);

  return json({
    valid:          true,
    code:           promoCode.code,
    discountAmount,
    finalAmount,
    discountType:   promoCode.discountType,
    discountValue:  promoCode.discountValue,
  });
}
