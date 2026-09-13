/**
 * Shared validation for a listing's accepted payment methods + cash-deposit
 * config (SPACE / PROGRAM / EVENT). Kept in one place so the create and edit
 * routes for all three listing kinds enforce identical rules.
 *
 * Model (option "a"): there are no competing `acceptsOnline` / `acceptsCash`
 * booleans — `acceptedPaymentMethods` is the single source of truth. When a
 * listing accepts 'CASH', a deposit (paid online by card) MUST be configured:
 *   - PERCENT → value is a 1–100 percentage of the total.
 *   - FIXED   → value is an integer-DZD amount (> 0).
 */
export type CashDepositType = 'FIXED' | 'PERCENT';
export type AcceptedMethod = 'ONLINE' | 'CASH';

/**
 * Returns null when the payment config is valid, or a human-readable error
 * code/message otherwise. `methods` is the resulting accepted-methods list,
 * `type`/`value` the resulting deposit config (after any merge for edits).
 */
export function validateCashDeposit(
  methods: AcceptedMethod[] | undefined,
  type: CashDepositType | undefined | null,
  value: number | undefined | null,
): string | null {
  if (!methods?.includes('CASH')) return null;

  // NO deposit is a legitimate choice: plenty of hosts want the client to
  // simply turn up and pay the whole amount on site. This used to be
  // impossible — a deposit was mandatory whenever CASH was accepted, and
  // entering 0 was rejected as "must be greater than 0", so there was no way
  // to express it at all. Absent type AND value now means exactly that, and a
  // literal 0 is read the same way rather than refused.
  const wantsNoDeposit = (!type && value == null) || value === 0;
  if (wantsNoDeposit) return null;

  // A partial config is still an error — it is a half-filled form, not a
  // choice, and silently dropping one half would surprise the host.
  if (!type || value == null) {
    return 'Choose a deposit type and amount, or leave both empty to collect the full amount on site';
  }
  if (type === 'PERCENT' && (value < 1 || value > 100)) {
    return 'Percent deposit must be between 1 and 100';
  }
  if (type === 'FIXED' && value < 0) {
    return 'Fixed deposit cannot be negative';
  }
  return null;
}

/**
 * Normalize the deposit config for persistence: deposit fields are only kept
 * when the listing actually accepts cash, so toggling cash off clears them.
 */
export function normalizeDepositConfig(
  methods: AcceptedMethod[] | undefined,
  type: CashDepositType | undefined | null,
  value: number | undefined | null,
): { cashDepositType?: CashDepositType; cashDepositValue?: number } {
  // A zero deposit is stored as NO deposit, so every reader can keep asking the
  // one question it already asks — "is a deposit configured?" — instead of
  // having to also test for zero. `computeDeposit` and the booking forms all
  // treat an absent config as "collect everything on site".
  if (!methods?.includes('CASH') || !type || value == null || value === 0) return {};
  return { cashDepositType: type, cashDepositValue: value };
}

/* ─────────────────────── Dual pricing (online / cash) ─────────────────────── */

/**
 * The split-pricing resolver moved to `@/lib/listing-price` so the browser can
 * import the SAME function the settlement path uses — the apply form has to
 * show the price it is about to charge, and a second copy would drift. These
 * re-exports keep every existing server import working unchanged.
 */
export {
  effectiveListingPrice,
  resolveListingPricing,
  validateSplitPricing,
} from '@/lib/listing-price';
export type {
  ListingPriceMode,
  SplitPricing,
  ListingPricing,
} from '@/lib/listing-price';
