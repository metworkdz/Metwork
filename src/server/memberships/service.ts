/**
 * Membership service — tier logic and discounts.
 *
 * Source of truth for:
 *   - Effective membership code (checks expiry)
 *   - Per-member space / consultation / event discount, resolved through the
 *     frozen snapshot first (see `resolveMemberBenefits`)
 *   - Per-tier consultation discount constants (re-exported from the client-safe lib)
 *
 * NOTE ON PRICING: what a NEW purchase costs now comes from
 * `@/server/memberships/plan-config` (DB-backed, admin-editable). The
 * MEMBERSHIP_PRICES / SPACE_DISCOUNT constants below survive only as the
 * last-resort fallback and as the record of pre-repricing terms.
 */
import { db, type UserMembershipRecord, type MembershipPlanConfigRecord, type PlatformConfig } from '@/server/db/store';
import {
  CONSULTATION_DISCOUNT,
  consultationDiscountFraction,
} from '@/lib/consultation-pricing';
import {
  normalizePlanCode,
  planConfigsFrom,
  passCountFrom,
  type PaidPlanCode,
} from '@/server/memberships/plan-config';

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
 * LEGACY space-booking discount fractions — the asymmetric Builder 15 % /
 * Founder 20 % split that applied before the 2026-08 repricing.
 *
 * NO LONGER THE LIVE RATE. Live rates resolve through `resolveMemberBenefits`
 * (frozen snapshot → user mirror → plan config). This map is kept because
 * memberships bought under these terms are grandfathered onto them, and it is
 * the shape the historical regression test asserts against.
 * Keyed by both old membershipCode and new membershipTier.
 */
export const SPACE_DISCOUNT: Record<string, number> = {
  ENTREPRENEUR: 0.15, // Builder tier — 15 % off
  BUILDER:      0.15,
  STARTUP:      0.2,  // Founder tier — 20 % off
  FOUNDER:      0.2,
};

/**
 * LEGACY membership prices in integer DZD (pre-2026-08 repricing).
 *
 * NO LONGER THE CHARGED PRICE — the purchase route reads
 * `getPlanConfig()` + `computeCyclePrices()`. Retained so historical analytics
 * rows whose transactions predate `basePrice` metadata can still be valued.
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

// ---------------------------------------------------------------------------
// Member benefits — frozen-snapshot resolution
// ---------------------------------------------------------------------------

/** Where a member's resolved rates came from. Useful in tests and debugging. */
export type MemberBenefitsSource = 'snapshot' | 'user' | 'config' | 'none';

export interface MemberBenefits {
  /** Effective membership code — 'FREE' when absent or expired. */
  code: string;
  /** Canonical paid plan code, or null when the member is on FREE. */
  planCode: PaidPlanCode | null;
  /** Space + event booking discount fraction (0–1). */
  spaceDiscountRate: number;
  /** Consultation discount fraction (0–1). */
  consultationDiscountRate: number;
  /** Network Pass credits granted per month. */
  monthlyPassCount: number;
  source: MemberBenefitsSource;
}

const NO_BENEFITS: MemberBenefits = {
  code: 'FREE',
  planCode: null,
  spaceDiscountRate: 0,
  consultationDiscountRate: 0,
  monthlyPassCount: 0,
  source: 'none',
};

/** User shape `resolveMemberBenefits` needs. Satisfied by UserRecord. */
export type BenefitUserLike = MembershipUserLike & {
  id: string;
  membershipSpaceDiscountRate?: number;
  membershipConsultationDiscountRate?: number;
};

/** Minimal doc slice `resolveMemberBenefits` reads. */
type BenefitsSource = {
  userMemberships?: UserMembershipRecord[];
  membershipPlanConfigs?: MembershipPlanConfigRecord[];
  meta?: { platformConfig?: PlatformConfig };
};

/**
 * THE benefit resolver. Every discount and pass allowance in the app resolves
 * through this one function so a member can never be charged one rate and
 * shown another.
 *
 * Resolution order — most specific (and most frozen) first:
 *
 *   1. **Frozen snapshot** on the member's ACTIVE UserMembershipRecord. This is
 *      what they bought. An admin repricing must never move it.
 *   2. **User-record mirror** (`membershipSpaceDiscountRate` etc.) — covers
 *      grants that create no membership record, e.g. partner promos.
 *   3. **Live plan config** — the current terms, for members with neither.
 *   4. Zero, for FREE / expired / unknown codes.
 *
 * Pass counts follow the same order but skip step 2: `networkCreditsMax` on the
 * user is the cron's *output*, not a source of truth, so reading it back here
 * would be circular.
 */
export function resolveMemberBenefits(
  data: BenefitsSource,
  user: BenefitUserLike,
): MemberBenefits {
  const code = getEffectiveMembershipCode(user);
  const planCode = normalizePlanCode(code);
  if (!planCode) return { ...NO_BENEFITS, code };

  const config =
    planConfigsFrom(data).find((c) => c.planCode === planCode) ?? null;
  const configPassCount = passCountFrom(data, planCode);

  // 1. Frozen snapshot on the active membership record.
  const snapshot = (data.userMemberships ?? []).find(
    (m) =>
      m.userId === user.id &&
      m.status === 'ACTIVE' &&
      normalizePlanCode(m.plan) === planCode &&
      m.spaceDiscountRate !== undefined,
  );
  if (snapshot) {
    return {
      code,
      planCode,
      spaceDiscountRate:        clamp01(snapshot.spaceDiscountRate),
      consultationDiscountRate: clamp01(snapshot.consultationDiscountRate),
      monthlyPassCount:         Math.max(0, snapshot.monthlyPassCount ?? configPassCount),
      source: 'snapshot',
    };
  }

  // 2. User-record mirror (grants that create no membership record).
  //    A *number* is required, not merely "not undefined": the JSONB store
  //    round-trips a cleared field as `null`, and `null` used to satisfy this
  //    branch and then clamp to 0 — silently giving a paid member a 0 %
  //    discount instead of falling through to their plan's live terms.
  if (typeof user.membershipSpaceDiscountRate === 'number') {
    return {
      code,
      planCode,
      spaceDiscountRate:        clamp01(user.membershipSpaceDiscountRate),
      consultationDiscountRate: clamp01(user.membershipConsultationDiscountRate),
      monthlyPassCount:         configPassCount,
      source: 'user',
    };
  }

  // 3. Live config.
  return {
    code,
    planCode,
    spaceDiscountRate:        clamp01(config?.spaceDiscountRate),
    consultationDiscountRate: clamp01(config?.consultationDiscountRate),
    monthlyPassCount:         configPassCount,
    source: 'config',
  };
}

function clamp01(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Async form of `resolveMemberBenefits`, keyed by user id. */
export async function getMemberBenefits(userId: string): Promise<MemberBenefits> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return { ...NO_BENEFITS };
  return resolveMemberBenefits(data, user);
}

/**
 * Compute the space-booking discount fraction for a given user (0 if none).
 * Snapshot-aware — see `resolveMemberBenefits`.
 */
export async function getSpaceDiscountForUser(userId: string): Promise<number> {
  return (await getMemberBenefits(userId)).spaceDiscountRate;
}

/**
 * Compute the automatic consultation discount fraction for a given user
 * (0 if none). Snapshot-aware — see `resolveMemberBenefits`.
 */
export async function getConsultationDiscountForUser(userId: string): Promise<number> {
  return (await getMemberBenefits(userId)).consultationDiscountRate;
}

/**
 * Compute the event-registration discount fraction for a given user.
 * Events intentionally share the space rate.
 */
export async function getEventDiscountForUser(userId: string): Promise<number> {
  return getSpaceDiscountForUser(userId);
}

/** Monthly Network Pass allowance for a given user (snapshot-aware). */
export async function getMonthlyPassCountForUser(userId: string): Promise<number> {
  return (await getMemberBenefits(userId)).monthlyPassCount;
}
