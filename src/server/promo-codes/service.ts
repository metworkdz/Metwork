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
  if (process.env.NODE_ENV === 'production') return;

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

/* ─────────────────────── Scope (incubator-owned codes) ─────────────────────── */

export type PromoItemKind = 'SPACE' | 'PROGRAM' | 'EVENT';

/** The thing being bought, with the incubator that owns it resolved server-side. */
export interface PromoItemRef {
  kind:             PromoItemKind;
  id:               string;
  ownerIncubatorId: string | null;
}

interface PromoItemSource {
  spaces?:   Array<{ id: string; incubatorId: string }>;
  programs?: Array<{ id: string; incubatorId: string | null }>;
  events?:   Array<{ id: string; incubatorId: string }>;
}

/**
 * Resolve what is being bought and who owns it FROM THE STORE — never from the
 * request. A client names an id; the owner is looked up here, so a scoped code
 * cannot be redeemed against a listing the code's incubator does not own.
 */
export function resolvePromoItem(d: PromoItemSource, kind: PromoItemKind, id: string): PromoItemRef {
  const owner =
    kind === 'SPACE'   ? d.spaces?.find((x) => x.id === id)?.incubatorId
    : kind === 'PROGRAM' ? d.programs?.find((x) => x.id === id)?.incubatorId
    :                      d.events?.find((x) => x.id === id)?.incubatorId;
  return { kind, id, ownerIncubatorId: owner ?? null };
}

/**
 * THE gate for incubator-owned codes. Fail-closed:
 *   - a platform code (no owner, no scope) is unaffected;
 *   - a scoped code is valid only when an item is presented, that item is owned
 *     by the code's incubator, and its id is in the matching list;
 *   - a half-formed record (owner without scope or the reverse) is dead rather
 *     than accidentally global.
 * Every redemption path funnels through this, including the ones that present
 * no item at all (memberships, consultations) — those are rejected by design.
 */
export function promoScopeAllows(
  promo: { ownerIncubatorId?: string | null; scope?: PromoCodeRecord['scope'] },
  item?: PromoItemRef,
): boolean {
  const scoped = promo.scope != null || promo.ownerIncubatorId != null;
  if (!scoped) return true;
  if (!item) return false;
  if (!promo.scope || !promo.ownerIncubatorId) return false;
  if (item.ownerIncubatorId !== promo.ownerIncubatorId) return false;
  if (item.kind === 'SPACE')   return promo.scope.spaceIds.includes(item.id);
  if (item.kind === 'PROGRAM') return promo.scope.programIds.includes(item.id);
  return false; // events are not scopable
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
  itemKind?: 'SPACE' | 'PROGRAM' | 'EVENT',
  item?: PromoItemRef,
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
  if (promo.appliesTo && promo.appliesTo !== 'ALL' && itemKind && promo.appliesTo !== itemKind)
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code not valid for this item type' };
  if (!promoScopeAllows(promo, item))
    return { valid: false, discountAmount: 0, finalAmount: originalAmount, promoCodeId: null, error: 'Promo code not valid for this item' };

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
  reason:  'NOT_FOUND' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED' | 'NOT_APPLICABLE';
}
export type PromoValidationResultAsync = PromoCodeValidResult | PromoCodeInvalidResult;

/**
 * Async validator — for use in API route handlers.
 * Looks up the code from the DB directly.
 */
export async function validatePromoCode(
  code: string,
  /** What is being bought. Omit for purchases that are not a listing (memberships, consultations). */
  item?: { kind: PromoItemKind; id: string },
): Promise<PromoValidationResultAsync> {
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
  if (!promoScopeAllows(promo, item ? resolvePromoItem(data, item.kind, item.id) : undefined)) {
    return { valid: false, reason: 'NOT_APPLICABLE' };
  }

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
  // An incubator-owned code is never valid for a membership or a consultation,
  // whatever `appliesTo` says. (The async validator already rejects it without an
  // item; this is the second lock on the same door.)
  if (promoCode?.scope != null || promoCode?.ownerIncubatorId != null) return false;
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

/**
 * Thrown when a code name is already taken. `inactive` tells the caller the
 * holder is a deactivated code — the admin can reactivate, rename or delete it,
 * which is a more useful message than a bare "already exists".
 */
export class PromoCodeExistsError extends Error {
  constructor(public readonly inactive: boolean) {
    super('PROMO_CODE_EXISTS');
    this.name = 'PromoCodeExistsError';
  }
}

/** One place that knows the full on-disk shape, including the legacy mirrored fields. */
export function newPromoRecord(
  input: Pick<CreatePromoCodeInput, 'discountPercent' | 'appliesTo' | 'expiresAt' | 'usageLimit'> & { code: string },
  now: string,
) {
  return {
    id:              randomUUID(),
    code:            input.code,
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
}

/** Create a new promo code. Throws PromoCodeExistsError if the name is already taken. */
export async function createPromoCode(input: CreatePromoCodeInput): Promise<PromoCodeRecord> {
  await ensurePromoCodesSeeded();

  const upper = input.code.toUpperCase().trim();
  const now   = new Date().toISOString();

  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) d.promoCodes = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (d.promoCodes as any[]).find((c) => c.code === upper);
    if (exists) throw new PromoCodeExistsError(!exists.isActive);

    const record = newPromoRecord({ ...input, code: upper }, now);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d.promoCodes as any[]).push(record);
    return record as unknown as PromoCodeRecord;
  });
}

export interface UpdatePromoCodeInput {
  code?:           string;
  appliesTo?:      CreatePromoCodeInput['appliesTo'];
  isActive?:       boolean;
  usageLimit?:     number | null;
  expiresAt?:      string | null;
  discountPercent?: number;
}

/**
 * Update a promo code. Returns null if not found. Throws PromoCodeExistsError
 * when a rename collides with another code.
 *
 * Edits only affect FUTURE redemptions: card checkouts freeze the discounted
 * total at intent time, so a quoted price never moves under a customer.
 */
export async function updatePromoCode(
  id: string,
  input: UpdatePromoCodeInput,
): Promise<PromoCodeRecord | null> {
  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promo = (d.promoCodes as any[]).find((c) => c.id === id);
    if (!promo) return null;

    applyPromoEdits(d.promoCodes as PromoCodeRecord[], promo, input);
    return promo as PromoCodeRecord;
  });
}

/**
 * Apply an edit to a record in place (inside a db.update). Shared by the admin
 * and incubator paths so a rename can never skip the uniqueness check in one of
 * them. `viewerIncubatorId` is set for an incubator caller: the "held by a
 * deactivated code" hint is then only given for that incubator's OWN codes, so
 * the message does not reveal the state of someone else's code.
 */
export function applyPromoEdits(
  codes: PromoCodeRecord[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promo: any,
  input: UpdatePromoCodeInput,
  viewerIncubatorId?: string,
): void {
  if (input.code !== undefined) {
    const upper = input.code.toUpperCase().trim();
    if (upper !== promo.code) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clash = (codes as any[]).find((c) => c.code === upper && c.id !== promo.id);
      if (clash) {
        const hint = viewerIncubatorId === undefined
          ? !clash.isActive
          : !clash.isActive && clash.ownerIncubatorId === viewerIncubatorId;
        throw new PromoCodeExistsError(hint);
      }
      promo.code = upper;
    }
  }
  if (input.appliesTo      !== undefined) promo.appliesTo      = input.appliesTo;
  if (input.isActive       !== undefined) promo.isActive       = input.isActive;
  if (input.usageLimit     !== undefined) { promo.usageLimit    = input.usageLimit; promo.maxUses = input.usageLimit; }
  if (input.expiresAt      !== undefined) { promo.expiresAt     = input.expiresAt;  promo.validUntil = input.expiresAt; }
  if (input.discountPercent !== undefined) { promo.discountPercent = input.discountPercent; promo.discountValue = input.discountPercent; }
  promo.updatedAt = new Date().toISOString();
}

/**
 * Permanently delete a promo code, freeing its name for reuse. Returns the
 * deleted record, or null if it did not exist.
 *
 * Safe because nothing reads a promo record by id after the fact: bookings keep
 * `promoCodeId` only for settlement, and `consumePromoCodeSync` is a no-op for
 * an id that no longer exists. A checkout already in flight keeps the discounted
 * total it was quoted; it simply stops counting toward a (now gone) usage limit.
 */
export async function deletePromoCode(id: string): Promise<PromoCodeRecord | null> {
  return await db.update((d) => {
    if (!Array.isArray(d.promoCodes)) return null;
    const idx = d.promoCodes.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const [removed] = d.promoCodes.splice(idx, 1);
    return removed as PromoCodeRecord;
  });
}
