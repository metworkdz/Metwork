/**
 * Server-authoritative consultation charge math.
 *
 * Thin server-side wrapper over the ONE canonical calculator in
 * `@/lib/consultation-pricing` (`resolveConsultationCharge`) so the booking API,
 * the price-breakdown UIs, and this server helper never diverge. The free
 * monthly-quota credit was removed — every consultation is now charged, with the
 * membership-tier discount (or a bigger promo, never both) absorbed by the
 * platform. Every amount is integer DZD; nothing is ever read from the client.
 */
import {
  resolveConsultationCharge,
  type ConsultationChargeBreakdown,
} from '@/lib/consultation-pricing';

export type { ConsultationChargeBreakdown };

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
}

/** Compute the final consultation charge + breakdown (no-stacking, larger wins). */
export function computeConsultationCharge(
  input: ConsultationChargeInput,
): ConsultationChargeBreakdown {
  return resolveConsultationCharge(input);
}
