/**
 * Consultation duration options + price helper. Single source of truth shared
 * by the booking dialog and the public mentor profile so the two never drift.
 *
 * Pricing model: `consultationFee` is the mentor's per-hour rate (DZD); the
 * price for a session is pro-rated by its duration.
 */
export interface DurationOption {
  value: number;
  label: string;
}

export const DURATION_OPTIONS: DurationOption[] = [
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2 h 30' },
  { value: 180, label: '3 hours' },
];

/** Compute price from hourly rate and duration. Returns 0 if the fee is free. */
export function computePrice(feePerHour: number, durationMinutes: number): number {
  if (!feePerHour || feePerHour <= 0) return 0;
  return Math.round((durationMinutes / 60) * feePerHour);
}

/** Which discount source was applied to a consultation charge. */
export type ConsultationDiscountSource = 'none' | 'tier' | 'promo';

export interface ConsultationChargeInput {
  /** Mentor's per-hour fee in DZD (0 / absent ⇒ free mentor). */
  feePerHour: number;
  /** Session length in minutes. */
  durationMinutes: number;
  /** Membership-tier discount fraction (0–1). Members only — 0 for guests. */
  membershipDiscountFraction?: number;
  /** Validated promo discount percentage (0–100). Ignored when a fixed amount is given. */
  promoDiscountPercent?: number;
  /** Pre-resolved promo discount in DZD (fixed promos / already computed on base). */
  promoDiscountAmount?: number;
}

export interface ConsultationChargeBreakdown {
  /** Pre-discount session price. */
  basePrice: number;
  /** DZD removed by the membership tier (0 unless the tier discount won). */
  tierDiscountAmount: number;
  /** DZD removed by the promo (0 unless the promo won). */
  promoDiscountAmount: number;
  /** Which discount actually applied — 'none' | 'tier' | 'promo'. */
  appliedSource: ConsultationDiscountSource;
  /** Final integer DZD to collect (0 for a free mentor / full discount). */
  gross: number;
}

/**
 * THE consultation charge calculation. Single source of truth shared by the
 * booking API (via `computeConsultationCharge`), the price-breakdown dialogs,
 * and the dashboard panel.
 *
 * No-stacking rule: the membership-tier discount and the promo code do NOT
 * combine — whichever yields the larger DZD reduction is applied, never both.
 * Ties go to the membership tier (so an entered-but-not-larger promo is not
 * consumed). The consultant is always paid on the full base elsewhere; this
 * only decides what the client is charged.
 */
export function resolveConsultationCharge(
  input: ConsultationChargeInput,
): ConsultationChargeBreakdown {
  const basePrice = computePrice(input.feePerHour ?? 0, input.durationMinutes);

  const tierFraction = clampFraction(input.membershipDiscountFraction ?? 0);
  const tierAmount = Math.round(basePrice * tierFraction);

  const promoRaw =
    input.promoDiscountAmount != null && input.promoDiscountAmount > 0
      ? Math.round(input.promoDiscountAmount)
      : Math.round((basePrice * clampPercent(input.promoDiscountPercent ?? 0)) / 100);
  const promoAmount = Math.min(Math.max(0, promoRaw), basePrice);

  // Larger discount wins; ties resolve to the tier (membership benefit).
  let appliedSource: ConsultationDiscountSource = 'none';
  let tierDiscountAmount = 0;
  let promoDiscountAmount = 0;
  if (tierAmount > 0 || promoAmount > 0) {
    if (promoAmount > tierAmount) {
      appliedSource = 'promo';
      promoDiscountAmount = promoAmount;
    } else {
      appliedSource = 'tier';
      tierDiscountAmount = tierAmount;
    }
  }

  const gross = Math.max(0, basePrice - tierDiscountAmount - promoDiscountAmount);
  return { basePrice, tierDiscountAmount, promoDiscountAmount, appliedSource, gross };
}

function clampFraction(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 1 ? 1 : v;
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 100 ? 100 : v;
}

/**
 * CANONICAL read helper for a mentor's price state — the ONE place the public
 * profile and both booking dialogs resolve pricing so they never drift.
 *
 * `consultationFee` (per-hour DZD) is the single source of truth for what a
 * client is actually charged (see `computeConsultationCharge`). A mentor with
 * no positive fee is *unpriced* — the UI must say "pricing not yet set" rather
 * than implying the session is free. The genuinely-free offering is the opt-in
 * `freeIntroEnabled` intro call, which is independent of the hourly rate.
 */
export interface MentorPricingView {
  /** Per-hour rate in DZD; 0 when unset. */
  feePerHour: number;
  /** True when the mentor has a real (positive) hourly rate configured. */
  isPriced: boolean;
  /** True when the mentor offers a free intro call (opt-in, admin/consultant). */
  freeIntro: boolean;
}

export function resolveMentorPricing(m: {
  consultationFee?: number | null;
  freeIntroEnabled?: boolean | null;
}): MentorPricingView {
  const feePerHour = m.consultationFee && m.consultationFee > 0 ? m.consultationFee : 0;
  return {
    feePerHour,
    isPriced: feePerHour > 0,
    freeIntro: Boolean(m.freeIntroEnabled),
  };
}
