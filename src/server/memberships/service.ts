/**
 * Membership service — tier logic and discounts.
 *
 * Source of truth for:
 *   - Effective membership code (checks expiry)
 *   - Per-tier space booking discount
 *   - Per-tier consultation discount (re-exported from the client-safe lib)
 *   - Membership prices
 */
import { db } from '@/server/db/store';
import {
  CONSULTATION_DISCOUNT,
  consultationDiscountFraction,
} from '@/lib/consultation-pricing';

// Re-export the canonical consultation-discount constant + resolver so server
// callers have a single import surface. The definition lives in the client-safe
// lib (client price-breakdown UIs can't import this DB-backed module).
export { CONSULTATION_DISCOUNT, consultationDiscountFraction };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal interface required to compute the effective membership code. */
export interface MembershipUserLike {
  membershipCode: string | null;
  membershipExpiresAt?: string | null;
  /** New-style tier field (EXPLORER | BUILDER | FOUNDER). Optional for backward compat. */
  membershipTier?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Space booking discount fraction per membership tier (e.g. 0.20 = 20 % off).
 * Keyed by both old membershipCode and new membershipTier.
 */
export const SPACE_DISCOUNT: Record<string, number> = {
  ENTREPRENEUR: 0.15, // Builder tier — 15 % off
  BUILDER:      0.15,
  STARTUP:      0.2,  // Founder tier — 20 % off
  FOUNDER:      0.2,
};

/**
 * Membership prices in integer DZD.
 *
 * Entrepreneurs are billed SEMESTERLY (6 months, no discount) or YEARLY
 * (12 months, 30 % off). `monthly` is the per-month figure shown in the UI
 * — it is never charged directly.
 *   semesterly = monthly × 6   (no discount)
 *   yearly     = monthly × 12 × 0.7   (30 % off)
 */
export const MEMBERSHIP_PRICES: Record<
  string,
  { monthly: number; semesterly: number; yearly: number }
> = {
  ENTREPRENEUR: { monthly: 3_500, semesterly: 3_500 * 6, yearly: Math.round(3_500 * 12 * 0.7) },
  STARTUP:      { monthly: 6_500, semesterly: 6_500 * 6, yearly: Math.round(6_500 * 12 * 0.7) },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the user's *effective* membership code, taking expiry into account.
 * Returns 'FREE' when the membership has expired or is null.
 * Accepts any object with `membershipCode` and optional `membershipExpiresAt`
 * (works with both `UserRecord` and `SessionUser`).
 */
/**
 * Return the user's *effective* membership code, taking expiry into account.
 *
 * Priority:
 *   1. If expired → 'FREE'
 *   2. membershipCode if set (old system: 'ENTREPRENEUR' | 'STARTUP')
 *   3. membershipTier if set (new system: 'BUILDER' | 'FOUNDER')
 *   4. 'FREE' fallback
 *
 * This dual lookup ensures both purchase-route users (which set membershipCode)
 * and partner-promo users (which only set membershipTier) get correct quotas.
 */
export function getEffectiveMembershipCode(user: MembershipUserLike): string {
  // Expiry check applies to both code and tier
  if (user.membershipExpiresAt && new Date(user.membershipExpiresAt) <= new Date()) {
    return 'FREE';
  }
  // Old system: membershipCode ('ENTREPRENEUR' | 'STARTUP'). Normalized
  // case-insensitively — the partner-promo path historically wrote
  // 'builder'/'founder' in lowercase, which must resolve to the same tier.
  const code = user.membershipCode ? user.membershipCode.toUpperCase() : null;
  if (code && code !== 'FREE') {
    if (code === 'ENTREPRENEUR' || code === 'STARTUP' || code === 'BUILDER' || code === 'FOUNDER') {
      return code;
    }
    // Unrecognized code: a recognized tier wins over an opaque legacy value.
    if (user.membershipTier === 'BUILDER' || user.membershipTier === 'FOUNDER') {
      return user.membershipTier;
    }
    return user.membershipCode as string;
  }
  // New system: membershipTier ('BUILDER' | 'FOUNDER')
  if (user.membershipTier === 'BUILDER') return 'BUILDER';
  if (user.membershipTier === 'FOUNDER') return 'FOUNDER';
  return 'FREE';
}

/**
 * Compute the space-booking discount percentage for a given user (0 if none).
 */
export async function getSpaceDiscountForUser(userId: string): Promise<number> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return 0;
  const effectiveCode = getEffectiveMembershipCode(user);
  return SPACE_DISCOUNT[effectiveCode] ?? 0;
}

/**
 * Compute the automatic consultation discount fraction for a given user
 * (0 if none). Mirrors `getSpaceDiscountForUser` — Builder 15 %, Founder 20 %.
 */
export async function getConsultationDiscountForUser(userId: string): Promise<number> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return 0;
  return consultationDiscountFraction(getEffectiveMembershipCode(user));
}

/**
 * Compute the event-registration discount percentage for a given user.
 * Mirrors `SPACE_DISCOUNT` — Builder/Founder get the same fraction off events.
 */
export async function getEventDiscountForUser(userId: string): Promise<number> {
  return getSpaceDiscountForUser(userId);
}
