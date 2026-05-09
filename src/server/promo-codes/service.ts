/**
 * Promo code service.
 *
 * Seeds example promo codes on first run (like the mentor seeding pattern).
 * Provides helpers to validate and consume a code inside a db.update critical section.
 */
import { randomUUID } from 'node:crypto';
import { db, type PromoCodeRecord } from '@/server/db/store';

/** Example promo codes seeded on first run */
const seedCodes: Omit<PromoCodeRecord, 'id'>[] = [
  {
    code:          'WELCOME50',
    discountType:  'PERCENTAGE',
    discountValue: 50,
    maxUses:       100,
    useCount:      0,
    validFrom:     '2025-01-01T00:00:00Z',
    validUntil:    '2027-12-31T23:59:59Z',
    isActive:      true,
    createdAt:     '2025-01-01T00:00:00Z',
  },
  {
    code:          'FREE100',
    discountType:  'PERCENTAGE',
    discountValue: 100,
    maxUses:       10,
    useCount:      0,
    validFrom:     '2025-01-01T00:00:00Z',
    validUntil:    '2027-12-31T23:59:59Z',
    isActive:      true,
    createdAt:     '2025-01-01T00:00:00Z',
  },
  {
    code:          'SAVE5000',
    discountType:  'FIXED',
    discountValue: 5000,
    maxUses:       null,
    useCount:      0,
    validFrom:     '2025-01-01T00:00:00Z',
    validUntil:    null,
    isActive:      true,
    createdAt:     '2025-01-01T00:00:00Z',
  },
];

export async function ensurePromoCodesSeeded(): Promise<void> {
  const data = await db.read();
  if (data.meta?.promoCodesSeeded) return;

  await db.update((d) => {
    if (d.meta?.promoCodesSeeded) return;
    if (!d.meta) d.meta = {};
    if (!Array.isArray(d.promoCodes)) d.promoCodes = [];
    if (d.promoCodes.length === 0) {
      d.promoCodes.push(
        ...seedCodes.map<PromoCodeRecord>((c) => ({ id: randomUUID(), ...c })),
      );
    }
    d.meta.promoCodesSeeded = true;
  });
}

export interface PromoValidationResult {
  valid:          boolean;
  discountAmount: number;
  finalAmount:    number;
  promoCodeId:    string | null;
  error?:         string;
}

/**
 * Validates a promo code and computes the discount.
 * Does NOT increment useCount — call `consumePromoCode` inside db.update for that.
 */
export function validatePromoCode(
  codes: PromoCodeRecord[],
  codeStr: string,
  originalAmount: number,
): PromoValidationResult {
  const now   = new Date().toISOString();
  const upper = codeStr.toUpperCase().trim();

  const promo = codes.find((c) => c.code === upper && c.isActive);

  if (!promo)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Invalid promo code' };
  if (promo.validUntil && promo.validUntil < now)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code has expired' };
  if (promo.validFrom > now)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code is not yet active' };
  if (promo.maxUses !== null && promo.useCount >= promo.maxUses)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code usage limit reached' };

  let discountAmount: number;
  if (promo.discountType === 'PERCENTAGE') {
    discountAmount = Math.round(originalAmount * (promo.discountValue / 100));
  } else {
    discountAmount = Math.min(promo.discountValue, originalAmount);
  }
  const finalAmount = Math.max(0, originalAmount - discountAmount);

  return { valid: true, discountAmount, finalAmount, promoCodeId: promo.id };
}

/**
 * Increments the useCount on a promo code record in-place.
 * Call this inside a `db.update` mutator after validating.
 */
export function consumePromoCode(
  codes: PromoCodeRecord[],
  promoCodeId: string,
): void {
  const promo = codes.find((c) => c.id === promoCodeId);
  if (promo) promo.useCount += 1;
}
