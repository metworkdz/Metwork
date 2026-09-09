/**
 * Split pricing (online / cash) for a PROGRAM or EVENT — THE single
 * implementation, shared by the server and the browser.
 *
 * A listing carries one base `price` plus two optional overrides:
 *   • `onlinePrice` — what an ONLINE_FULL payer owes.
 *   • `cashPrice`   — what a CASH payer owes IN TOTAL (deposit online +
 *                     balance on site).
 * Either may be absent, in which case that surface falls back to `price`.
 *
 * This module is deliberately dependency-free so a client component can import
 * it directly. It used to live in `@/server/bookings/listing-payment`, which
 * still re-exports it for the server call sites — there is exactly one
 * implementation, so a display can never disagree with what is charged. That
 * disagreement was a real bug: the apply form printed `program.price` for both
 * methods while the card path charged the resolved one.
 */

/** Booking surface that selects the base price for a split-priced listing. */
export type ListingPriceMode = 'ONLINE_FULL' | 'CASH_DEPOSIT';

export interface SplitPricing {
  onlinePrice?: number | null;
  cashPrice?: number | null;
}

/** Is this override usable? (absent / negative / non-finite → fall back.) */
function usable(candidate: number | null | undefined): candidate is number {
  return candidate != null && Number.isFinite(candidate) && candidate >= 0;
}

/**
 * Effective base price (integer DZD) for one booking surface, picking the
 * online/cash override when configured and falling back to `price` otherwise.
 * Fully backward compatible: a listing with neither override always resolves
 * to `price` on both surfaces.
 */
export function effectiveListingPrice(
  price: number,
  split: SplitPricing | undefined,
  mode: ListingPriceMode,
): number {
  const candidate = mode === 'CASH_DEPOSIT' ? split?.cashPrice : split?.onlinePrice;
  if (usable(candidate)) return Math.round(candidate);
  return price;
}

/** Both surfaces at once, plus whether they actually differ. */
export interface ListingPricing {
  /** Total owed when paying the whole thing online by card / wallet. */
  online: number;
  /** Total owed when paying cash (deposit online + balance on site). */
  cash: number;
  /** True only when the two totals are genuinely different amounts. */
  differs: boolean;
}

/**
 * Resolve both surfaces for display. Use this anywhere a price is *shown*
 * next to a payment-method choice, so the two numbers on screen are the two
 * numbers the server will charge.
 */
export function resolveListingPricing(
  price: number,
  split: SplitPricing | undefined,
): ListingPricing {
  const online = effectiveListingPrice(price, split, 'ONLINE_FULL');
  const cash = effectiveListingPrice(price, split, 'CASH_DEPOSIT');
  return { online, cash, differs: online !== cash };
}

/**
 * Validate optional split-price overrides. Returns null when valid, or a
 * human-readable message. Each override is optional; when present it must be a
 * non-negative integer.
 */
export function validateSplitPricing(split: SplitPricing | undefined): string | null {
  for (const v of [split?.onlinePrice, split?.cashPrice]) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      return 'Online and cash prices must be non-negative whole numbers';
    }
  }
  return null;
}
