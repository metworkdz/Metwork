/**
 * Promo-code service.
 *
 * Validates and consumes promo codes.  All state is stored in the shared
 * JSON store under `db.promoCodes[]`.
 */
import { db, type PromoCodeRecord } from '@/server/db/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromoAppliesTo = 'ALL' | 'MEMBERSHIP' | 'SPACE' | 'CONSULTATION';

export type PromoValidation =
  | { valid: true; promoCode: PromoCodeRecord; discountPercent: number }
  | { valid: false; reason: 'NOT_FOUND' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED' };

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function listPromoCodes(): Promise<PromoCodeRecord[]> {
  const data = await db.read();
  return [...(data.promoCodes ?? [])].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * Validate a promo code without consuming it.
 * Case-insensitive match on the code string.
 */
export async function validatePromoCode(code: string): Promise<PromoValidation> {
  const data = await db.read();
  const promo = (data.promoCodes ?? []).find(
    (p) => p.code.toUpperCase() === code.trim().toUpperCase(),
  );

  if (!promo) return { valid: false, reason: 'NOT_FOUND' };
  if (!promo.isActive) return { valid: false, reason: 'INACTIVE' };
  if (promo.expiresAt && new Date(promo.expiresAt) <= new Date()) {
    return { valid: false, reason: 'EXPIRED' };
  }
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
    return { valid: false, reason: 'LIMIT_REACHED' };
  }

  return { valid: true, promoCode: promo, discountPercent: promo.discountPercent };
}

/**
 * Increment the usage counter for a code.  Should only be called after a
 * successful purchase — runs inside its own `db.update` critical section.
 */
export async function consumePromoCode(code: string): Promise<void> {
  await db.update((d) => {
    const promo = (d.promoCodes ?? []).find(
      (p) => p.code.toUpperCase() === code.trim().toUpperCase(),
    );
    if (promo) {
      promo.usedCount += 1;
      promo.updatedAt = new Date().toISOString();
    }
  });
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

export interface CreatePromoCodeInput {
  code: string;
  discountPercent: number;
  appliesTo: PromoAppliesTo;
  expiresAt: string | null;
  usageLimit: number | null;
}

/** Returns true when a promo applies to a given purchase type. */
export function promoAppliesToType(
  promo: PromoCodeRecord,
  type: 'SPACE' | 'MEMBERSHIP' | 'CONSULTATION',
): boolean {
  return promo.appliesTo === 'ALL' || promo.appliesTo === type;
}

export async function createPromoCode(
  input: CreatePromoCodeInput,
): Promise<PromoCodeRecord> {
  return db.update((d) => {
    if (!Array.isArray(d.promoCodes)) d.promoCodes = [];

    const upper = input.code.trim().toUpperCase();
    if (d.promoCodes.some((p) => p.code === upper)) {
      throw new Error('PROMO_CODE_EXISTS');
    }

    const now = new Date().toISOString();
    const record: PromoCodeRecord = {
      id: crypto.randomUUID(),
      code: upper,
      discountPercent: input.discountPercent,
      appliesTo: input.appliesTo,
      expiresAt: input.expiresAt,
      usageLimit: input.usageLimit,
      usedCount: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    d.promoCodes.push(record);
    return record;
  });
}

export async function updatePromoCode(
  id: string,
  patch: Partial<Pick<PromoCodeRecord, 'isActive' | 'usageLimit' | 'expiresAt' | 'discountPercent'>>,
): Promise<PromoCodeRecord | null> {
  return db.update((d) => {
    const promo = (d.promoCodes ?? []).find((p) => p.id === id);
    if (!promo) return null;
    Object.assign(promo, patch, { updatedAt: new Date().toISOString() });
    return { ...promo };
  });
}
