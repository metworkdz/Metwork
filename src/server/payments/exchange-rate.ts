/**
 * EUR/DZD rate — read + admin update.
 *
 * The rate lives on the platform-settings record (alongside the other
 * admin-tunable switches) and exists for exactly one purpose: pricing the
 * international-card (Stripe) hosted checkout. It is NEVER a display value —
 * no client-facing surface shows the rate, only the DZD price and, on the card
 * option, the converted EUR figure the server computed.
 *
 * Fail-closed: an unset or invalid rate means international card payment is
 * unavailable. We never fall back to a guessed rate — that would mischarge.
 */
import { db } from '@/server/db/store';
import { DEFAULT_PLATFORM_SETTINGS } from '@/server/admin/settings-defaults';
import { isValidEurDzdRate } from './fx';
import { isStripeConfigured } from './stripe-provider';

/**
 * Current admin-configured rate, or null when unset/invalid.
 *
 * Callers must snapshot the returned value onto the transaction they are
 * creating; re-reading it later would let an admin edit reprice work in flight.
 */
export async function getEurToDzdRate(): Promise<number | null> {
  const data = await db.read();
  const rate = data.platformSettings?.eurToDzdRate ?? DEFAULT_PLATFORM_SETTINGS.eurToDzdRate;
  return isValidEurDzdRate(rate) ? rate : null;
}

export interface InternationalCardAvailability {
  available: boolean;
  /** Frozen-at-read rate; null when unavailable. */
  rate: number | null;
}

/**
 * Whether the Visa/Mastercard option may be offered right now: Stripe keys
 * present AND a usable rate configured. Both are required — offering the option
 * without one of them would fail at redirect time, after the user committed.
 */
export async function getInternationalCardAvailability(): Promise<InternationalCardAvailability> {
  if (!isStripeConfigured()) return { available: false, rate: null };
  const rate = await getEurToDzdRate();
  return { available: rate != null, rate };
}

export interface SetExchangeRateResult {
  rate: number;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Admin update. Validation lives in the route (Zod) and in `isValidEurDzdRate`;
 * this writes the value plus its audit trail in one mutation.
 */
export async function setEurToDzdRate(
  rate: number,
  adminUserId: string,
): Promise<SetExchangeRateResult> {
  const now = new Date().toISOString();
  return db.update<SetExchangeRateResult>((store) => {
    const current = store.platformSettings ?? { ...DEFAULT_PLATFORM_SETTINGS };
    store.platformSettings = {
      ...current,
      eurToDzdRate: rate,
      eurToDzdRateUpdatedAt: now,
      eurToDzdRateUpdatedBy: adminUserId,
      updatedAt: now,
    };
    return { rate, updatedAt: now, updatedBy: adminUserId };
  });
}
