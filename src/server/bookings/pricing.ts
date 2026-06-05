/**
 * Server-side money math for card-settled bookings — the single source of
 * truth for the deposit (D) and the platform commission (C) on the total (T).
 *
 * Everything here is integer-DZD and recomputed server-side at settlement;
 * the client never supplies T, D or C. Keep this the ONLY place these are
 * derived so the booking forms, the intent creation and the wallet settlement
 * can never disagree.
 */
import type { IncubatorRecord } from '@/server/db/store';
import { getEffectiveSubscriptionCode } from '@/server/incubator/service';
import { platformCommissions } from '@/config/memberships';

export type CashDepositType = 'FIXED' | 'PERCENT';

export interface DepositConfig {
  cashDepositType?: CashDepositType | null;
  cashDepositValue?: number | null;
}

export type DepositResult =
  | { ok: true; deposit: number }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'INVALID_CONFIG' | 'INVALID_TOTAL' };

/**
 * Required online deposit D for a CASH booking of total `total`.
 *
 *   PERCENT → round(value/100 * T)
 *   FIXED   → min(value, T)
 *
 * Enforces 0 < D <= T. Returns a discriminated result so callers fail loudly
 * rather than silently charging the wrong amount.
 */
export function computeDeposit(total: number, cfg: DepositConfig): DepositResult {
  if (!Number.isFinite(total) || total <= 0) return { ok: false, reason: 'INVALID_TOTAL' };
  const type = cfg.cashDepositType;
  const value = cfg.cashDepositValue;
  if (!type || value == null || !Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  let deposit: number;
  if (type === 'PERCENT') {
    if (value < 1 || value > 100) return { ok: false, reason: 'INVALID_CONFIG' };
    deposit = Math.round((value / 100) * total);
  } else {
    deposit = Math.min(Math.round(value), total);
  }

  // Clamp into the legal open-closed interval (0, T]. A 0-rounding deposit on a
  // tiny total is bumped to 1 DZD so the booking still requires a real charge.
  if (deposit <= 0) deposit = Math.min(1, total);
  if (deposit > total) deposit = total;
  if (deposit <= 0) return { ok: false, reason: 'INVALID_TOTAL' };
  return { ok: true, deposit };
}

/**
 * The incubator's effective commission rate (decimal 0–1) using the EXISTING
 * subscription rules: commission-based (pay-as-you-go) subs pay the platform
 * rate; FLAT/Pro subs pay 0. Read-time expiry is applied via
 * getEffectiveSubscriptionCode, so a lapsed Pro plan resumes commission.
 */
export function effectiveCommissionRate(incubator: IncubatorRecord): number {
  return getEffectiveSubscriptionCode(incubator) === 'COMMISSION'
    ? platformCommissions.incubatorBooking
    : 0;
}

/** Platform commission C on the TOTAL (integer DZD). */
export function computeCommission(total: number, rate: number): number {
  if (!Number.isFinite(total) || total <= 0 || rate <= 0) return 0;
  return Math.round(total * rate);
}
