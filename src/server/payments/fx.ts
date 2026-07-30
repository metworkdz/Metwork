/**
 * Foreign-exchange conversion for international (Stripe) card payments.
 *
 * THE single place DZD is ever turned into another currency. Everything else in
 * the money layer — pricing, commission, the consultant ledger, receipts,
 * notifications — stays integer DZD and must never import this module.
 *
 * Rules (owner-locked):
 *  - The rate is admin-configured (`platformSettings.eurToDzdRate`) and is
 *    SNAPSHOTTED onto the transaction at checkout-session creation. A later
 *    rate change never rewrites an in-flight or settled payment.
 *  - Rounding is UP to the cent (`Math.ceil`), in Metwork's favour: rounding
 *    down would silently eat the fraction on every single transaction.
 *  - Stripe rejects charges under €0.50, so a converted amount below the floor
 *    is a hard error rather than a silently-adjusted charge.
 */

/** Stripe's documented minimum chargeable amount for EUR. */
export const STRIPE_MIN_EUR = 0.5;

/** Widest rate we'll accept from the admin form — a typo guard, not a market view. */
export const MIN_EUR_DZD_RATE = 1;
export const MAX_EUR_DZD_RATE = 100_000;

export class FxError extends Error {
  constructor(
    readonly code: 'RATE_NOT_CONFIGURED' | 'RATE_INVALID' | 'AMOUNT_BELOW_MINIMUM',
    message: string,
  ) {
    super(message);
    this.name = 'FxError';
  }
}

/** True when `rate` is a usable EUR→DZD rate. */
export function isValidEurDzdRate(rate: unknown): rate is number {
  return (
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate >= MIN_EUR_DZD_RATE &&
    rate <= MAX_EUR_DZD_RATE
  );
}

export interface EurConversion {
  /** EUR amount the card is billed, 2dp. */
  amountEur: number;
  /** Same amount in cents — what Stripe's `unit_amount` wants. */
  amountEurCents: number;
  /** The rate this conversion froze. */
  rate: number;
}

/**
 * Convert integer DZD to the EUR amount to bill, at a given frozen rate.
 * Throws `FxError` rather than returning a fallback — a mispriced charge is
 * worse than a failed one.
 */
export function convertDzdToEur(amountDzd: number, rate: number | null | undefined): EurConversion {
  if (rate == null) {
    throw new FxError(
      'RATE_NOT_CONFIGURED',
      'No EUR/DZD rate is configured. An admin must set one before international card payments can be accepted.',
    );
  }
  if (!isValidEurDzdRate(rate)) {
    throw new FxError('RATE_INVALID', `Configured EUR/DZD rate is not usable: ${String(rate)}`);
  }
  if (!Number.isFinite(amountDzd) || amountDzd <= 0) {
    throw new FxError('AMOUNT_BELOW_MINIMUM', 'Amount must be a positive DZD value.');
  }

  // Round UP to the cent — see module header.
  const amountEurCents = Math.ceil((amountDzd / rate) * 100);
  const amountEur = amountEurCents / 100;

  if (amountEur < STRIPE_MIN_EUR) {
    throw new FxError(
      'AMOUNT_BELOW_MINIMUM',
      `Converted amount €${amountEur.toFixed(2)} is below the €${STRIPE_MIN_EUR.toFixed(2)} card minimum.`,
    );
  }

  return { amountEur, amountEurCents, rate };
}
