/**
 * Central commission engine — the SINGLE source of truth for the platform's
 * take on every money-moving platform payment (bookings + online cash deposits).
 *
 * Model (admin-configurable, see PlatformConfig.receiverCommissionRate /
 * payerFeeRate):
 *   • receiver commission — a cut taken FROM the account holder (provider) on
 *     the base amount that flows through the platform. Default 5 %.
 *   • payer fee — a surcharge added ON TOP of the base, charged to the buyer.
 *     Default 2 %.
 *   ⇒ platform take = receiver + payer = 7 % of base by default.
 *
 * Plan exemption (decided 2026-06-14):
 *   • COMMISSION-plan incubators + ALL trainers → full rates apply.
 *   • FLAT (Pro) incubators → receiver rate forced to 0 (they already pay a
 *     subscription) BUT the payer fee still applies to their buyers.
 *
 * This is a PURE function: it never reads the request, the client, or the DB.
 * Callers resolve the admin rates from PlatformConfig and pass them in, so the
 * same math is reused at settlement, in previews and in tests. Every amount is
 * integer DZD; nothing here is ever trusted from the client.
 */

/** Provider billing plan that scopes the receiver-side exemption. */
export type ProviderPlan = 'COMMISSION' | 'FLAT';

/** Transaction types the engine can price. Only PAYMENT is wired today. */
export type CommissionTransactionType = 'PAYMENT';

/** Hard defaults, used when admin config is absent. */
export const DEFAULT_RECEIVER_COMMISSION_RATE = 0.05;
export const DEFAULT_PAYER_FEE_RATE = 0.02;

/** Admin-configured rates (subset of PlatformConfig). Both nullable/optional. */
export interface CommissionRateConfig {
  receiverCommissionRate?: number | null;
  payerFeeRate?: number | null;
}

export interface CommissionInput {
  /** What is being charged. Reserved for future per-type rates. */
  transactionType: CommissionTransactionType;
  /** Provider billing plan — drives the receiver-side exemption. */
  providerPlan: ProviderPlan;
  /**
   * Base amount (integer DZD) that flows through the platform for THIS charge.
   * For an ONLINE_FULL booking this is the full total T; for a CASH_DEPOSIT it
   * is the online deposit D only (never the cash remainder).
   */
  baseAmount: number;
  /** Admin rates from PlatformConfig. Omit to use the hard defaults. */
  config?: CommissionRateConfig | null;
}

export interface CommissionQuote {
  /** Effective rates actually applied (decimal 0–1), after plan exemption. */
  receiverRate: number;
  payerRate: number;
  /** Cut taken from the provider on the base (integer DZD). */
  receiverCommission: number;
  /** Surcharge added on top, charged to the payer (integer DZD). */
  payerFee: number;
  /** What the payer is charged online: base + payerFee. */
  grossChargedToPayer: number;
  /** What lands in the provider wallet: base − receiverCommission. */
  netToProviderWallet: number;
  /** Total platform revenue: receiverCommission + payerFee. */
  platformTake: number;
}

/** Clamp a configured rate into [0,1]; fall back to `dflt` when absent/invalid. */
function resolveRate(value: number | null | undefined, dflt: number): number {
  if (value == null || !Number.isFinite(value)) return dflt;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Resolve the EFFECTIVE receiver/payer rates for a provider plan, applying the
 * FLAT receiver exemption. Pure — pass the admin config in.
 */
export function resolveCommissionRates(
  providerPlan: ProviderPlan,
  config?: CommissionRateConfig | null,
): { receiverRate: number; payerRate: number } {
  const receiverBase = resolveRate(config?.receiverCommissionRate, DEFAULT_RECEIVER_COMMISSION_RATE);
  const payerRate = resolveRate(config?.payerFeeRate, DEFAULT_PAYER_FEE_RATE);
  // FLAT (Pro) providers pay no receiver commission; buyers still pay the fee.
  const receiverRate = providerPlan === 'FLAT' ? 0 : receiverBase;
  return { receiverRate, payerRate };
}

/**
 * THE commission calculation. Every settlement path, preview and receipt must
 * call this — no inline percentage math anywhere else.
 */
export function computeCommission(input: CommissionInput): CommissionQuote {
  const base = Number.isFinite(input.baseAmount) && input.baseAmount > 0
    ? Math.round(input.baseAmount)
    : 0;
  const { receiverRate, payerRate } = resolveCommissionRates(input.providerPlan, input.config);

  const receiverCommission = Math.round(base * receiverRate);
  const payerFee = Math.round(base * payerRate);

  return {
    receiverRate,
    payerRate,
    receiverCommission,
    payerFee,
    grossChargedToPayer: base + payerFee,
    netToProviderWallet: base - receiverCommission,
    platformTake: receiverCommission + payerFee,
  };
}
