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
  if (!type || value == null) {
    return 'A deposit must be configured when accepting cash payments';
  }
  if (type === 'PERCENT' && (value < 1 || value > 100)) {
    return 'Percent deposit must be between 1 and 100';
  }
  if (type === 'FIXED' && value <= 0) {
    return 'Fixed deposit must be greater than 0';
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
  if (!methods?.includes('CASH') || !type || value == null) return {};
  return { cashDepositType: type, cashDepositValue: value };
}
