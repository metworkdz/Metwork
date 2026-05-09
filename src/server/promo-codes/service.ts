/**
 * Promo code service.
 *
 * Seeds example promo codes on first run.
 * Exports both a legacy sync API (used inside db.update callbacks in
 * bookings/service.ts) and a modern async API consumed by the REST routes.
 */
import { randomUUID } from 'node:crypto';
import { db, type PromoCodeRecord } from '@/server/db/store';

/* ─────────────────────── Seed data ─────────────────────── */

const seedCodes = [
  {
    code:           'WELCOME50',
    discountType:   'PERCENTAGE' as const,
    discountValue:  50,
    discountPercent: 50,
    appliesTo:      'ALL' as const,
    maxUses:        100,
    usageLimit:     100,
    useCount:       0,
    usedCount:      0,
    validFrom:      '2025-01-01T00:00:00Z',
    validUntil:     '2027-12-31T23:59:59Z',
    expiresAt:      '2027-12-31T23:59:59Z',
    isActive:       true,
    createdAt:      '2025-01-01T00:00:00Z',
    updatedAt:      '2025-01-01T00:00:00Z',
  },
  {
    code:           'FREE100',
    discountType:   'PERCENTAGE' as const,
    discountValue:  100,
    discountPercent: 100,
    appliesTo:      'ALL' as const,
    maxUses:        10,
    usageLimit:     10,
    useCount:       0,
    usedCount:      0,
    validFrom:      '2025-01-01T00:00:00Z',
    validUntil:     '2027-12-31T23:59:59Z',
    expiresAt:      '2027-12-31T23:59:59Z',
    isActive:       true,
    createdAt:      '2025-01-01T00:00:00Z',
    updatedAt:      '2025-01-01T00:00:00Z',
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...seedCodes.map((c) => ({ id: randomUUID(), ...c }) as any),
      );
    }
    d.meta.promoCodesSeeded = true;
  });
}

/* ─────────────────────── Legacy sync helpers (used by bookings/service.ts) ─────────────────────── */

export interface PromoValidationResult {
  valid:          boolean;
  discountAmount: number;
  finalAmount:    number;
  promoCodeId:    string | null;
  error?:         string;
}

/**
 * Synchronous validator — call this INSIDE a db.update callback where you
 * already have the codes array in-memory.
 */
export function validatePromoCodeSync(
  codes: PromoCodeRecord[],
  codeStr: string,
  originalAmount: number,
): PromoValidationResult {
  const now   = new Date().toISOString();
  const upper = codeStr.toUpperCase().trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promo = codes.find((c: any) => c.code === upper && c.isActive) as any;

  if (!promo)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Invalid promo code' };
  if (promo.validUntil && promo.validUntil < now)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code has expired' };
  if (promo.validFrom && promo.validFrom > now)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code is not yet active' };
  if (promo.maxUses !== null && promo.maxUses !== undefined && promo.useCount >= promo.maxUses)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code usage limit reached' };

  const pct = promo.discountPercent ?? (promo.discountType === 'PERCENTAGE' ? promo.discountValue : 0);
  const discountAmount = Math.round(originalAmount * (pct / 100));
  const finalAmount    = Math.max(0, originalAmount - discountAmount);

  return { valid: true, discountAmount, finalAmount, promoCodeId: promo.id };
}

/**
 * Increments useCount in-place — call this INSIDE a db.update callback.
 */
export function consumePromoCodeSync(
  codes: PromoCodeRecord[],
  promoCodeId: string,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promo = codes.find((c: any) => c.id === promoCodeId) as any;
  if (promo) {
    promo.useCount  = (promo.useCount  ?? 0) + 1;
    promo.usedCount = (promo.usedCount ?? 0) + 1;
    promo.updatedAt = new Date().toISOString();
  }
}

/* ─────────────────────── Modern async API ─────────────────────── */

export interface PromoCodeValidResult {
  valid:          true;
  promoCode:      PromoCodeRecord;
  discountPercent: number;
}
export interface PromoCodeInvalidResult {
  valid:   false;
  reason:  'NOT_FOUND' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED';
}
export type PromoValidationResultAsync = PromoCodeValidResult | PromoCodeInvalidResult;

/**
 * Async validator — for use in API route handlers.
 * Looks up the code from the DB directly.
 */
export async function validatePromoCode(code: string): Promise<PromoValidationResultAsync> {
  await ensurePromoCodesSeeded();
  const data  = await db.read();
  const codes = data.promoCodes ?? [];
  const now   = new Date().toISOString();
  const upper = code.toUpperCase().trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promo = codes.find((c: any) => c.code === upper) as any;

  if (!promo)                                                          return { valid: false, reason: 'NOT_FOUND' };
  if (!promo.isActive)                                                 return { valid: false, reason: 'INACTIVE' };
  if ((promo.validUntil ?? promo.expiresAt) && (promo.validUntil ?? promo.expiresAt) < now) return { valid: false, reason: 'EXPIRED' };
  const limit = promo.maxUses ?? promo.usageLimit ?? null;
  const used  = promo.useCount ?? promo.usedCount ?? 0;
  if (limit !== null && used >= limit)                                 return { valid: false, reason: 'LIMIT_REACHED' };

  const discountPercent = promo.discountPercent
    ?? (promo.discountType === 'PERCENTAGE' ? promo.discountValue : 0);

  return { valid: true, promoCode: promo as PromoCodeRecord, discountPercent };
}

/**
 * Async consume — for use in API route handlers after a successful transaction.
 */
export async function consumePromoCode(code: string): Promise<void> {
  await db.update((d) => {
    const upper = code.toUpperCase().trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promo = (d.promoCodes ?? []).find((c: any) => c.code === upper) as any;
    if (promo) {
      promo.useCount  = (promo.useCount  ?? 0) + 1;
      promo.usedCount = (promo.usedCount ?? 0) + 1;
      promo.updatedAt = new Date().toISOString();
    }
  });
}

/** Returns true when the promo applies to `type` or to ALL. */
export function promoAppliesToType(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promoCode: any,
  type: 'SPACE' | 'MEMBERSHIP' | 'CONSULTATION',
): boolean {
  const appliesTo: string = promoCode?.appliesTo ?? 'ALL';
  return appliesTo === 'ALL' || appliesTo === type;
}

/* ─────────────────────── Admin CRUD ─────────────────────── */

/** List all promo codes (newest first). */
export async function listPromoCodes(): Promise<PromoCodeRecord[]> {
  await ensurePromoCodesSeeded();
  const data = await db.read();
  return [...(data.promoCodes ?? [])].reverse();
}

export interface CreatePromoCodeInput {
  code:            string;
  discountPercent: number;
  appliesTo:       'ALL' | 'MEMBERSHIP' | 'SPACE' | 'CONSULTATION';
  expiresAt:       string | null;
  usageLimit:      number | null;
}

/** Create a new promo code. Throws 'PROMO_CODE_EXISTS' if code already taken. */
export async function createPromoCode(input: CreatePromoCodeInput): Promise<PromoCodeRecord> {
  await ensurePromoCodesSeeded();

  const upper = input.code.toUpperCase().trim();
  const now   = new Date().toISOString();

  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) d.promoCodes = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (d.promoCodes as any[]).find((c) => c.code === upper);
    if (exists) throw new Error('PROMO_CODE_EXISTS');

    const record = {
      id:              randomUUID(),
      code:            upper,
      /* legacy fields (used by sync validator) */
      discountType:    'PERCENTAGE' as const,
      discountValue:   input.discountPercent,
      maxUses:         input.usageLimit,
      useCount:        0,
      validFrom:       now,
      validUntil:      input.expiresAt,
      /* new admin fields */
      discountPercent: input.discountPercent,
      appliesTo:       input.appliesTo,
      expiresAt:       input.expiresAt,
      usageLimit:      input.usageLimit,
      usedCount:       0,
      isActive:        true,
      createdAt:       now,
      updatedAt:       now,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d.promoCodes as any[]).push(record);
    return record as unknown as PromoCodeRecord;
  });
}

export interface UpdatePromoCodeInput {
  isActive?:       boolean;
  usageLimit?:     number | null;
  expiresAt?:      string | null;
  discountPercent?: number;
}

/** Update a promo code. Returns null if not found. */
export async function updatePromoCode(
  id: string,
  input: UpdatePromoCodeInput,
): Promise<PromoCodeRecord | null> {
  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promo = (d.promoCodes as any[]).find((c) => c.id === id);
    if (!promo) return null;

    if (input.isActive       !== undefined) promo.isActive       = input.isActive;
    if (input.usageLimit     !== undefined) { promo.usageLimit    = input.usageLimit; promo.maxUses = input.usageLimit; }
    if (input.expiresAt      !== undefined) { promo.expiresAt     = input.expiresAt;  promo.validUntil = input.expiresAt; }
    if (input.discountPercent !== undefined) { promo.discountPercent = input.discountPercent; promo.discountValue = input.discountPercent; }
    promo.updatedAt = new Date().toISOString();

    return promo as PromoCodeRecord;
  });
}
