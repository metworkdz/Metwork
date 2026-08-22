import type { PlatformSettingsRecord, MembershipPlanConfigRecord } from '@/server/db/store';
import { DEFAULT_PLAN_BENEFITS, PAID_PLAN_CODES } from '@/lib/membership-benefits';

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsRecord = {
  appName:         'Metwork',
  maintenanceMode: false,
  signupsEnabled:  true,
  paymentsEnabled: true,
  // Null until an admin sets it — international (Stripe) card payment stays
  // unavailable rather than falling back to a guessed rate.
  eurToDzdRate:          null,
  eurToDzdRateUpdatedAt: null,
  eurToDzdRateUpdatedBy: null,
  updatedAt:       new Date(0).toISOString(),
};

/** Default commission rules seeded on first load */
export const DEFAULT_COMMISSION_RULES = [
  {
    id:              'rule_investment',
    name:            'Investment commission',
    transactionType: 'INVESTMENT',
    rate:            0.07,
    description:     'Platform fee on each confirmed investment transaction (7%).',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_booking',
    name:            'Incubator booking commission',
    transactionType: 'PAYMENT',
    rate:            0.05,
    description:     'Metwork cut from space / program bookings when the incubator is on the COMMISSION plan (5%).',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_topup',
    name:            'Top-up processing fee',
    transactionType: 'TOP_UP',
    rate:            0.015,
    description:     'Payment gateway processing fee passed through to users on wallet top-ups (1.5%).',
    isActive:        false,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_mentor_consultation',
    name:            'Mentor consultation commission',
    transactionType: 'MENTOR_CONSULTATION',
    rate:            0.20,
    description:     'Platform commission on paid mentor consultations (20%). Consultants receive the remaining 80%. Applies to every consultant regardless of how they joined.',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_mentor_program',
    name:            'Mentor program commission',
    transactionType: 'MENTOR_PROGRAM',
    rate:            0.05,
    description:     'Platform commission on paid consultant-owned programs (5%). Consultants receive the remaining 95%. Deliberately lower than the consultation rate.',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
] as const;

/**
 * Default entrepreneur membership plans, seeded on first admin load (same
 * additive, never-overwrite pattern as DEFAULT_COMMISSION_RULES).
 *
 * Cycle prices are DERIVED, never stored — see `computeCyclePrices` in
 * `@/lib/billing-cycles`, the one helper shared with the incubator FLAT plan:
 *   semesterly = monthlyPrice × semesterlyMonths          (no discount)
 *   annual     = monthlyPrice × 12 × (1 − annualDiscount) (−30 %)
 *
 * With the values below:
 *   Entrepreneur — 1 500 /mo → 9 000 / 6 mo → 12 600 / yr
 *   Startup      — 3 500 /mo → 21 000 / 6 mo → 29 400 / yr
 *
 * Coworking pass counts are NOT here — they stay canonical in
 * `meta.platformConfig.{builder,founder}MonthlyCredits` (Entrepreneur 0,
 * Startup 5). Those field names still carry the plans' former tier names.
 */
export const DEFAULT_MEMBERSHIP_PLAN_CONFIGS: readonly MembershipPlanConfigRecord[] =
  PAID_PLAN_CODES.map((planCode) => ({
    planCode,
    ...DEFAULT_PLAN_BENEFITS[planCode],
    isActive:  true,
    updatedAt: new Date(0).toISOString(),
  }));

/**
 * Discount rates as they stood BEFORE the 2026-08 repricing (15 % / 20 %,
 * asymmetric across both spaces and consultations). Used only to backfill the
 * frozen snapshot of memberships bought under the old terms.
 * Mirrors LEGACY_MONTHLY_PASS_COUNTS in the store.
 */
export const LEGACY_PLAN_DISCOUNT_RATES = {
  ENTREPRENEUR: { spaceDiscountRate: 0.15, consultationDiscountRate: 0.15 },
  STARTUP:      { spaceDiscountRate: 0.20, consultationDiscountRate: 0.20 },
} as const;
