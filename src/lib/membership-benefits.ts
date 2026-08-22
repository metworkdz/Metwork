/**
 * Membership benefits — the client-safe half.
 *
 * Holds the default plan terms and the helpers that turn a user object into
 * the discount fractions to DISPLAY. No DB imports, so browser price previews
 * and the server both consume one definition.
 *
 * Authority split, deliberately:
 *   - the SERVER decides what is charged, via `resolveMemberBenefits` in
 *     `@/server/memberships/service` (frozen snapshot → mirror → live config);
 *   - this module only decides what the browser *renders* before submitting,
 *     preferring the member's own frozen rates carried on the session and
 *     falling back to the shipped defaults when a legacy account has none.
 *
 * `DEFAULT_PLAN_BENEFITS` lives here (rather than in the server-side seed file)
 * so the client can import it without reaching into `src/server/`. The seed in
 * `@/server/admin/settings-defaults` is built FROM these values.
 */
import { resolveTier } from '@/lib/tier-utils';

/** Canonical paid plan codes. Entrepreneur → ENTREPRENEUR, Startup → STARTUP. */
export const PAID_PLAN_CODES = ['ENTREPRENEUR', 'STARTUP'] as const;
export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];

/**
 * Normalize any membership code or tier to a canonical paid plan code.
 *
 * Four spellings exist for two plans — `ENTREPRENEUR`/`BUILDER` and
 * `STARTUP`/`FOUNDER` (the tier field still carries the plans' former names,
 * Builder and Founder) — and the partner-promo path historically wrote them
 * lowercase. Every lookup goes through here so no caller has to know that.
 * Returns null for FREE / EXPLORER / unrecognized values.
 */
export function normalizePlanCode(codeOrTier: string | null | undefined): PaidPlanCode | null {
  if (!codeOrTier) return null;
  const v = codeOrTier.toUpperCase();
  if (v === 'ENTREPRENEUR' || v === 'BUILDER') return 'ENTREPRENEUR';
  if (v === 'STARTUP' || v === 'FOUNDER') return 'STARTUP';
  return null;
}

export interface PlanBenefits {
  monthlyPrice: number;
  semesterlyMonths: number;
  annualDiscountPercent: number;
  consultationDiscountRate: number;
  spaceDiscountRate: number;
  recommended: boolean;
}

/**
 * Shipped default terms per plan — the values seeded into
 * `membershipPlanConfigs` on first admin load, and the last-resort fallback
 * everywhere else.
 *
 *   Entrepreneur — 1 500 /mo → 9 000 / 6 mo → 12 600 / yr
 *   Startup      — 3 500 /mo → 21 000 / 6 mo → 29 400 / yr
 *
 * Cycle prices are DERIVED from `monthlyPrice`, never stored — see
 * `computeCyclePrices`. Nothing anywhere should restate 21 000 or 29 400.
 *
 * The two plans DIVERGE on consultations (Entrepreneur 10 %, Startup 20 %) and
 * agree on spaces (15 %). That asymmetry is deliberate and reflects who absorbs
 * the discount: the consultation discount comes out of Metwork's own 20 %
 * commission — the consultant is still paid the full price — while the space
 * discount comes out of the venue's share, not out of Metwork's 5 %.
 *
 * Coworking pass counts are NOT here: they stay canonical in
 * `meta.platformConfig` (Entrepreneur 0, Startup 5).
 */
export const DEFAULT_PLAN_BENEFITS: Record<PaidPlanCode, PlanBenefits> = {
  ENTREPRENEUR: {
    monthlyPrice:             1_500,
    semesterlyMonths:         6,
    annualDiscountPercent:    30,
    consultationDiscountRate: 0.10,
    spaceDiscountRate:        0.15,
    recommended:              true,
  },
  STARTUP: {
    monthlyPrice:             3_500,
    semesterlyMonths:         6,
    annualDiscountPercent:    30,
    consultationDiscountRate: 0.20,
    spaceDiscountRate:        0.15,
    recommended:              false,
  },
};

/** Minimal user shape these helpers read. Satisfied by SessionUser. */
export interface BenefitDisplayUser {
  membershipTier?: string | null;
  membershipCode?: string | null;
  membershipExpiresAt?: string | null;
  /** Frozen rates carried on the session, when the account has them. */
  membershipSpaceDiscountRate?: number;
  membershipConsultationDiscountRate?: number;
}

function clamp01(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** True when the account has a paid, unexpired membership. */
function hasActivePaidPlan(user: BenefitDisplayUser | null | undefined): PaidPlanCode | null {
  if (!user) return null;
  if (user.membershipExpiresAt && new Date(user.membershipExpiresAt) <= new Date()) return null;
  const tier = resolveTier(user);
  return normalizePlanCode(tier);
}

/**
 * Space / event booking discount fraction to display for this user.
 * Prefers the member's own frozen rate; falls back to the plan default.
 */
export function memberSpaceDiscountFraction(user: BenefitDisplayUser | null | undefined): number {
  const plan = hasActivePaidPlan(user);
  if (!plan) return 0;
  if (user?.membershipSpaceDiscountRate !== undefined) {
    return clamp01(user.membershipSpaceDiscountRate);
  }
  return DEFAULT_PLAN_BENEFITS[plan].spaceDiscountRate;
}

/**
 * Consultation discount fraction to display for this user.
 * Prefers the member's own frozen rate; falls back to the plan default.
 */
export function memberConsultationDiscountFraction(
  user: BenefitDisplayUser | null | undefined,
): number {
  const plan = hasActivePaidPlan(user);
  if (!plan) return 0;
  if (user?.membershipConsultationDiscountRate !== undefined) {
    return clamp01(user.membershipConsultationDiscountRate);
  }
  return DEFAULT_PLAN_BENEFITS[plan].consultationDiscountRate;
}
