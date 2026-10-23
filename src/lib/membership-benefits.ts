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
import type { UserRole } from '@/types/auth';
import { isFreelancerPremiumOnSale } from '@/config/feature-flags';

/**
 * Canonical paid plan codes.
 *
 *   ENTREPRENEUR       — the retired 1 500 DA "Entrepreneur" plan (tier BUILDER).
 *                        No longer sold; members keep it until it expires.
 *   STARTUP            — the entrepreneur "Founder" plan (tier FOUNDER). The
 *                        code predates the name; it was "Startup" until
 *                        Metwork 2.0, and existing Startup members ARE Founder.
 *   FREELANCER_PREMIUM — the freelancer "Premium" plan. Stored with tier FOUNDER
 *                        so every rank-based check (perks, events) treats it as
 *                        the top paid tier; the code is what tells it apart.
 */
export const PAID_PLAN_CODES = ['ENTREPRENEUR', 'STARTUP', 'FREELANCER_PREMIUM'] as const;
export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];

/** Who a plan is for. Fixed per code — not admin-editable. */
export const PLAN_AUDIENCE: Record<PaidPlanCode, 'ENTREPRENEUR' | 'FREELANCER'> = {
  ENTREPRENEUR:       'ENTREPRENEUR',
  STARTUP:            'ENTREPRENEUR',
  FREELANCER_PREMIUM: 'FREELANCER',
};

/**
 * Plans on sale, per role. THE purchase whitelist: the purchase route, the
 * renewal cron and every plan card read it, so a plan can't be advertised to
 * a role that the server would refuse. Roles absent here buy nothing.
 */
const PURCHASABLE_PLANS: Partial<Record<UserRole, readonly PaidPlanCode[]>> = {
  ENTREPRENEUR: ['STARTUP'],
  FREELANCER:   ['FREELANCER_PREMIUM'],
};

export function purchasablePlansFor(role: UserRole | null | undefined): readonly PaidPlanCode[] {
  if (role === 'FREELANCER' && !isFreelancerPremiumOnSale()) return [];
  return (role && PURCHASABLE_PLANS[role]) || [];
}

export function canPurchasePlan(role: UserRole | null | undefined, plan: PaidPlanCode): boolean {
  return purchasablePlansFor(role).includes(plan);
}

/**
 * The tier a plan is stored with. Founder and freelancer Premium share the top
 * rank so rank-based gates (perks, events) treat them alike.
 */
export function tierForPlan(plan: PaidPlanCode): 'BUILDER' | 'FOUNDER' {
  return plan === 'ENTREPRENEUR' ? 'BUILDER' : 'FOUNDER';
}

/** Billing cycles on sale for new purchases. Semesterly is retired (kept on old records). */
export const PURCHASE_CYCLES = ['monthly', 'yearly'] as const;
export type PurchaseCycle = (typeof PURCHASE_CYCLES)[number];

/**
 * Normalize any membership code or tier to a canonical paid plan code.
 *
 * Four spellings exist for the two entrepreneur plans — `ENTREPRENEUR`/`BUILDER` and
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
  if (v === 'FREELANCER_PREMIUM') return 'FREELANCER_PREMIUM';
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
 *   Founder (STARTUP)            — 1 900 /mo → 18 240 / yr (20 % off)
 *   Premium (FREELANCER_PREMIUM) — 2 500 /mo → 24 000 / yr (20 % off)
 *   Entrepreneur (retired)       — 1 500 /mo, kept only so its members resolve
 *
 * Cycle prices are DERIVED from `monthlyPrice`, never stored — see
 * `computeCyclePrices`. Nothing anywhere should restate 18 240 or 24 000.
 *
 * Both paid plans give 10 % on consultations and 10 % on spaces. Who absorbs
 * each is unchanged: the consultation discount comes out of Metwork's own
 * commission — the consultant is still paid the full price — while the space
 * discount comes out of the venue's share, not out of Metwork's 5 %.
 *
 * A deployment seeded before Metwork 2.0 does NOT pick these up by itself
 * (seeding is additive): `applyMetwork2PlanTerms` in plan-config is the
 * one-time bridge, run by scripts/metwork2-reprice-memberships.ts.
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
    recommended:              false,
  },
  STARTUP: {
    monthlyPrice:             1_900,
    semesterlyMonths:         6,
    annualDiscountPercent:    20,
    consultationDiscountRate: 0.10,
    spaceDiscountRate:        0.10,
    recommended:              true,
  },
  FREELANCER_PREMIUM: {
    monthlyPrice:             2_500,
    semesterlyMonths:         6,
    annualDiscountPercent:    20,
    consultationDiscountRate: 0.10,
    spaceDiscountRate:        0.10,
    recommended:              true,
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
  // The code wins: a freelancer Premium member carries tier FOUNDER, which on
  // its own would read as the entrepreneur Founder plan.
  return normalizePlanCode(user.membershipCode) ?? normalizePlanCode(resolveTier(user));
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
