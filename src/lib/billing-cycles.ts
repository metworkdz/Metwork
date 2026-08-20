/**
 * Billing-cycle math — THE single source of truth for turning a monthly rate
 * into what is actually charged for a longer cycle.
 *
 * Shared by BOTH subscription products so the two can never drift:
 *   - incubator FLAT ("Pro") plan  — `@/server/incubator/service`
 *   - entrepreneur memberships     — `@/server/memberships/plan-config`
 *
 * The rule, unchanged from the original FLAT-plan implementation:
 *   monthly    = monthlyPrice                                   (charged as-is)
 *   semesterly = monthlyPrice × semesterlyMonths                (NO discount)
 *   annual     = monthlyPrice × 12 × (1 − annualDiscount / 100) (discounted)
 *
 * Client-safe on purpose (no DB, no server-only imports) so price previews in
 * the browser compute from the same function the settlement path uses.
 */

/** Billing cycles the platform can charge for. */
export type BillingCycle = 'MONTHLY' | 'SEMESTERLY' | 'ANNUAL';

export interface CyclePriceInput {
  /** Reference monthly rate in DZD. */
  monthlyPrice: number;
  /** Months in a semesterly cycle. Defaults to 6. */
  semesterlyMonths?: number;
  /** Percentage off the 12-month lump sum (0–100). Defaults to 0. */
  annualDiscountPercent?: number;
}

export interface CyclePrices {
  /** One month at the reference rate. */
  monthly: number;
  /** Full amount charged for one semesterly period (no discount). */
  semesterly: number;
  /** Full amount charged for twelve months (discounted). */
  annual: number;
  /** Per-month display figure for the annual cycle (annual ÷ 12). */
  annualMonthlyEquivalent: number;
  /** Echoed back so callers render the badge from one place. */
  annualDiscountPercent: number;
  /** Echoed back so callers render "billed every N months" from one place. */
  semesterlyMonths: number;
}

const DEFAULT_SEMESTERLY_MONTHS = 6;

/** Clamp to a sane percentage; a bad config must never produce a negative price. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Clamp to a non-negative integer month count. */
function clampMonths(value: number): number {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_SEMESTERLY_MONTHS;
  return Math.floor(value);
}

/**
 * Compute every cycle price from a monthly rate. All results are integer DZD.
 */
export function computeCyclePrices(input: CyclePriceInput): CyclePrices {
  const monthly = Math.max(0, Math.round(input.monthlyPrice || 0));
  const semesterlyMonths = clampMonths(input.semesterlyMonths ?? DEFAULT_SEMESTERLY_MONTHS);
  const annualDiscountPercent = clampPercent(input.annualDiscountPercent ?? 0);

  const semesterly = monthly * semesterlyMonths;
  const annual = Math.round(monthly * 12 * (1 - annualDiscountPercent / 100));

  return {
    monthly,
    semesterly,
    annual,
    annualMonthlyEquivalent: Math.round(annual / 12),
    annualDiscountPercent,
    semesterlyMonths,
  };
}

/** Pick the amount charged for one cycle out of a computed price set. */
export function priceForCycle(prices: CyclePrices, cycle: BillingCycle): number {
  if (cycle === 'ANNUAL') return prices.annual;
  if (cycle === 'SEMESTERLY') return prices.semesterly;
  return prices.monthly;
}

/**
 * Compute the period end for a subscription cycle.
 *
 * UTC month arithmetic, matching the incubator FLAT plan's long-standing
 * behavior (including its day-overflow semantics: a 31st start rolls into the
 * following month when the target month is shorter).
 */
export function computePeriodEnd(
  start: string,
  cycle: BillingCycle,
  semesterlyMonths = DEFAULT_SEMESTERLY_MONTHS,
): string {
  const months =
    cycle === 'ANNUAL' ? 12 : cycle === 'SEMESTERLY' ? clampMonths(semesterlyMonths) : 1;
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}
