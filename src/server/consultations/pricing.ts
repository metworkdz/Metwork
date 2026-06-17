/**
 * Server-authoritative consultation charge math.
 *
 * Single source of truth for what a consultation costs under the instant-book,
 * pay-first flow. Ported verbatim from the discount ordering already used by
 * `POST /api/mentors/[id]/book` so the two never diverge: base (hourly fee
 * pro-rated by duration) → membership-tier discount → promo discount, with a
 * free credit (free monthly quota or a free intro session) collapsing the whole
 * thing to zero. Every amount is integer DZD; nothing is ever read from the
 * client.
 *
 * Pure function — callers resolve the membership fraction, the validated promo
 * percent, and the free-credit flag, then pass them in. This keeps it trivially
 * testable and reusable by previews.
 */
import { computePrice } from '@/lib/consultation-pricing';

export interface ConsultationChargeInput {
  /** Mentor's per-hour fee in DZD (0 / absent ⇒ free mentor). */
  feePerHour: number;
  /** Session length in minutes. */
  durationMinutes: number;
  /**
   * Membership-tier discount fraction (0–1). Members only — 0 for guests.
   * STARTUP/FOUNDER ⇒ 0.20, ENTREPRENEUR/BUILDER ⇒ 0.15, else 0.
   */
  membershipDiscountFraction?: number;
  /** Validated promo discount percentage (0–100). 0 / absent ⇒ none. */
  promoDiscountPercent?: number;
  /**
   * When true, a free credit (monthly quota or free intro) applies and the
   * whole charge collapses to 0 — tier and promo discounts are suppressed.
   */
  useFreeCredit?: boolean;
}

export interface ConsultationChargeBreakdown {
  /** Pre-discount session price. */
  basePrice: number;
  /** DZD removed by the membership tier (0 when free credit applies). */
  tierDiscountAmount: number;
  /** DZD removed by the promo, applied after the tier discount. */
  promoDiscountAmount: number;
  /** Final integer DZD to collect (0 for free credit / free mentor / full promo). */
  gross: number;
}

/** Compute the final consultation charge + breakdown. Mirrors the wallet book route. */
export function computeConsultationCharge(
  input: ConsultationChargeInput,
): ConsultationChargeBreakdown {
  const basePrice = computePrice(input.feePerHour ?? 0, input.durationMinutes);
  const useFree = input.useFreeCredit === true;

  const tierFraction = clampFraction(input.membershipDiscountFraction ?? 0);
  const tierDiscountAmount = useFree ? 0 : Math.round(basePrice * tierFraction);
  const afterTier = useFree ? 0 : Math.max(0, basePrice - tierDiscountAmount);

  const promoPercent = useFree ? 0 : clampPercent(input.promoDiscountPercent ?? 0);
  const promoDiscountAmount = promoPercent > 0 ? Math.round((afterTier * promoPercent) / 100) : 0;

  const gross = useFree ? 0 : Math.max(0, afterTier - promoDiscountAmount);

  return { basePrice, tierDiscountAmount, promoDiscountAmount, gross };
}

function clampFraction(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 1 ? 1 : v;
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 100 ? 100 : v;
}
