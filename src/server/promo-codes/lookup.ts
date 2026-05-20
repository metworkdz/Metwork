/**
 * Unified promo-code lookup.
 *
 * The platform has two parallel promo-code systems with different storage,
 * lifecycle, and security models. Rather than force them into one schema
 * (which would risk subtle bugs in a live financial system and break
 * partner-specific business logic), this module unifies the *validation
 * interface* so consumers can ask "is this code valid?" without caring
 * which underlying system answers.
 *
 * ── The two systems ─────────────────────────────────────────────────────
 *
 *   1. REGULAR promo codes (`PromoCodeRecord`)
 *      Domain: discounts on bookings (SPACE / PROGRAM / EVENT / CONSULTATION)
 *               and standalone MEMBERSHIP purchases.
 *      Storage: plaintext codes (case-insensitive lookup).
 *      Lifecycle: multi-use up to `usageLimit`, expires on `expiresAt`.
 *      Admin UI: /dashboard/admin/promo-codes
 *      Service:  src/server/promo-codes/service.ts
 *
 *   2. PARTNER promo codes (`PartnerPromoCodeRecord`)
 *      Domain: a partner-issued one-time discount on a paid MEMBERSHIP,
 *              activated at signup. Tied to a PartnerMembershipRecord that
 *              gets attribution + a network-payout share.
 *      Storage: SHA-256-hashed (issued in bulk, must survive partner-side
 *              email leaks without exposing valid codes).
 *      Lifecycle: single-use (`isUsed` flag), expires on `validUntil`.
 *      Admin UI: /dashboard/admin/partner-promo-codes
 *      Service:  src/server/network/partner-promo-service.ts
 *
 * They're not redundant — they serve different business goals — but they
 * shared duplicated validation logic (expiry, active-check, error shapes).
 * This module replaces those with a single entry point.
 *
 * ── Future direction ───────────────────────────────────────────────────
 *
 * Data-model merge into a single PromoCodeRecord with a `type` discriminator
 * is deferred (see audit notes). The interface here gives us migration
 * runway: when the merge happens, only this file changes; consumers stay
 * pointed at lookupAnyPromoCode().
 */

import { db, type PromoCodeRecord, type PartnerPromoCodeRecord } from '@/server/db/store';
import { createHash, timingSafeEqual } from 'node:crypto';

// ────────────────────────────────────────────────────────────────────────
// Public result shape (discriminated union)
// ────────────────────────────────────────────────────────────────────────

export type UnifiedPromoCodeResult =
  | {
      kind: 'REGULAR';
      code: string;
      /** 1–100 percentage discount. */
      discountPercent: number;
      /** Which item types this promo applies to (ALL = any). */
      appliesTo: 'ALL' | 'MEMBERSHIP' | 'SPACE' | 'CONSULTATION';
      /** Number of times already used. Compare against `usageLimit`. */
      usedCount: number;
      /** Null = unlimited uses. */
      usageLimit: number | null;
      /** ISO datetime. Null = never expires. */
      expiresAt: string | null;
      /** Raw record for callers that need extra fields (admin UI, etc.). */
      record: PromoCodeRecord;
    }
  | {
      kind: 'PARTNER';
      code: string;
      /** 1–99 percentage discount on the membership purchase. */
      discountPercent: number;
      /** Which membership tier this promo applies to. */
      membershipTier: 'BUILDER' | 'FOUNDER';
      /** The partner that gets attribution / payout. */
      partnerId: string;
      /** ISO date (YYYY-MM-DD). Partner codes use date-only expiry. */
      validUntil: string;
      /** Raw record for callers that need extra fields. */
      record: PartnerPromoCodeRecord;
    }
  | {
      kind: 'INVALID';
      /**
       * Machine-readable reason. Stable across both systems so callers
       * can map directly to HTTP error codes without per-type branching.
       */
      reason:
        | 'NOT_FOUND'
        | 'INACTIVE'         // regular promo `isActive=false` OR partner inactive
        | 'EXPIRED'          // both systems
        | 'LIMIT_REACHED'    // regular promo only
        | 'ALREADY_USED'     // partner promo only
        | 'PARTNER_INACTIVE' // partner-only
        | 'INVALID_FORMAT';  // empty / wrong type input
      /** Human-readable hint suitable for logs / debugging. Not for end users. */
      detail?: string;
    };

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function normaliseCode(input: string): string {
  return input.trim().toUpperCase();
}

function hashPartnerCode(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Constant-time hash comparison. Partner codes are sensitive — never
 * compare hashes with `===` because string comparison short-circuits on
 * the first differing character and leaks bits via timing.
 */
function safeHashEquals(storedHash: string, candidateHash: string): boolean {
  if (storedHash.length !== candidateHash.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(candidateHash, 'hex'),
    );
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────

/**
 * Look up a promo code in both systems. Returns the first match.
 *
 * Resolution order: regular promo codes are checked first because they're
 * the more common case (most users redeeming codes are doing booking
 * discounts, not partner-attributed signup discounts). Partner codes are
 * checked second.
 *
 * IMPORTANT: This is a read-only lookup. Consumers must still call the
 * appropriate service to consume the code:
 *   - Regular: src/server/promo-codes/service.ts → consumePromoCode()
 *   - Partner: src/server/network/partner-promo-service.ts → applyPromoCode()
 *
 * The two systems have different consume semantics (multi-use counter vs
 * single-use flag + membership creation), so consume is intentionally NOT
 * unified here. Forcing it through one function would hide the asymmetry
 * and create bugs.
 */
export async function lookupAnyPromoCode(input: string): Promise<UnifiedPromoCodeResult> {
  if (!input || typeof input !== 'string') {
    return { kind: 'INVALID', reason: 'INVALID_FORMAT', detail: 'empty or non-string input' };
  }
  const code = normaliseCode(input);
  if (code.length === 0) {
    return { kind: 'INVALID', reason: 'INVALID_FORMAT', detail: 'empty after trim' };
  }

  const data = await db.read();
  const now = new Date();
  const nowIso = now.toISOString();
  const todayDateOnly = nowIso.slice(0, 10);

  // ── 1. Regular promo codes (plaintext lookup) ─────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regular = (data.promoCodes ?? []).find((c: any) => c.code === code) as any;
  if (regular) {
    if (!regular.isActive) {
      return { kind: 'INVALID', reason: 'INACTIVE', detail: `regular code ${code}` };
    }
    const expiry = regular.expiresAt ?? regular.validUntil ?? null;
    if (expiry && expiry < nowIso) {
      return { kind: 'INVALID', reason: 'EXPIRED', detail: `regular code expired ${expiry}` };
    }
    const limit = regular.usageLimit ?? regular.maxUses ?? null;
    const used  = regular.usedCount ?? regular.useCount ?? 0;
    if (limit !== null && used >= limit) {
      return { kind: 'INVALID', reason: 'LIMIT_REACHED', detail: `regular code at ${used}/${limit}` };
    }
    const discountPercent =
      regular.discountPercent
      ?? (regular.discountType === 'PERCENTAGE' ? regular.discountValue : 0);

    return {
      kind: 'REGULAR',
      code: regular.code,
      discountPercent,
      appliesTo: regular.appliesTo ?? 'ALL',
      usedCount: used,
      usageLimit: limit,
      expiresAt: expiry,
      record: regular,
    };
  }

  // ── 2. Partner promo codes (hash lookup) ──────────────────────────────
  const candidateHash = hashPartnerCode(code);
  const partnerCode = (data.partnerPromoCodes ?? []).find((c) =>
    safeHashEquals(c.code, candidateHash),
  );
  if (partnerCode) {
    if (partnerCode.isUsed) {
      return { kind: 'INVALID', reason: 'ALREADY_USED', detail: `partner code consumed` };
    }
    if (partnerCode.validUntil < todayDateOnly) {
      return { kind: 'INVALID', reason: 'EXPIRED', detail: `partner code expired ${partnerCode.validUntil}` };
    }
    const partner = (data.partnerMemberships ?? []).find((p) => p.id === partnerCode.partnerId);
    if (!partner || !partner.isActive) {
      return { kind: 'INVALID', reason: 'PARTNER_INACTIVE', detail: `partner ${partnerCode.partnerId}` };
    }
    return {
      kind: 'PARTNER',
      code,
      discountPercent: partnerCode.discountPercentage,
      membershipTier: partnerCode.membershipTier,
      partnerId: partnerCode.partnerId,
      validUntil: partnerCode.validUntil,
      record: partnerCode,
    };
  }

  // ── 3. No match in either system ──────────────────────────────────────
  return { kind: 'INVALID', reason: 'NOT_FOUND' };
}

/**
 * Convenience predicate: is this promo applicable to a given purchase type?
 * Partner codes always apply to MEMBERSHIP only.
 */
export function promoAppliesTo(
  result: UnifiedPromoCodeResult,
  type: 'SPACE' | 'MEMBERSHIP' | 'CONSULTATION' | 'PROGRAM' | 'EVENT',
): boolean {
  if (result.kind === 'INVALID') return false;
  if (result.kind === 'PARTNER') return type === 'MEMBERSHIP';
  // REGULAR: 'ALL' matches everything; otherwise check exact match.
  if (result.appliesTo === 'ALL') return true;
  // appliesTo schema only includes MEMBERSHIP/SPACE/CONSULTATION today,
  // but treat PROGRAM/EVENT as SPACE-equivalent for legacy admin codes.
  if (result.appliesTo === 'SPACE') return type === 'SPACE' || type === 'PROGRAM' || type === 'EVENT';
  return result.appliesTo === type;
}
