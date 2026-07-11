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
