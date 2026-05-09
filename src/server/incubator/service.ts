/**
 * Incubator server-side helpers.
 *
 * Subscription pricing:
 *   FLAT / SEMESTERLY — 5 000 DZD × semesterlyMonths (default 6) = 30 000 DZD
 *   FLAT / YEARLY     — monthly × 12 × (1 − yearlyDiscount%) = 42 000 DZD default
 *   COMMISSION        — no subscription fee; platform takes commissionRate on bookings
 *
 * All prices sourced from db.meta.platformConfig (admin-editable), falling
 * back to defaultPlatformConfig if not yet set.
 */
import { db, type IncubatorRecord, defaultPlatformConfig, type PlatformConfig } from '@/server/db/store';

/* ─────────────────────────── Config helpers ─────────────────────────── */

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const data = await db.read();
  return { ...defaultPlatformConfig, ...data.meta?.platformConfig };
}

/* ─────────────────────────── Pricing helpers ─────────────────────────── */

export interface SubscriptionPricing {
  semesterlyAmount: number;   // total charged for a semester
  yearlyAmount: number;       // total charged for a year
  monthlyEquivalentSemesterly: number;
  monthlyEquivalentYearly: number;
  yearlyDiscountPercent: number;
  semesterlyMonths: number;
}

export function computeSubscriptionPricing(cfg: PlatformConfig): SubscriptionPricing {
  const { flatMonthlyPrice, semesterlyMonths, yearlyDiscountPercent } = cfg;
  const semesterlyAmount = flatMonthlyPrice * semesterlyMonths;
  const yearlyAmount = Math.round(flatMonthlyPrice * 12 * (1 - yearlyDiscountPercent / 100));
  return {
    semesterlyAmount,
    yearlyAmount,
    monthlyEquivalentSemesterly: flatMonthlyPrice,
    monthlyEquivalentYearly: Math.round(yearlyAmount / 12),
    yearlyDiscountPercent,
    semesterlyMonths,
  };
}

/** Compute the period-end date from a subscription start + billing cycle. */
export function computePeriodEnd(
  start: string,
  billingCycle: 'SEMESTERLY' | 'YEARLY',
  semesterlyMonths: number,
): string {
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + (billingCycle === 'YEARLY' ? 12 : semesterlyMonths));
  return d.toISOString();
}

/* ─────────────────────────── Incubator lookup ─────────────────────────── */

/**
 * Find the incubator record whose email matches the logged-in INCUBATOR user.
 * Returns null if no incubator record has been created for this user yet.
 */
export async function findIncubatorByUserEmail(email: string): Promise<IncubatorRecord | null> {
  const data = await db.read();
  return (data.incubators ?? []).find((inc) => inc.email === email) ?? null;
}

export async function findIncubatorById(id: string): Promise<IncubatorRecord | null> {
  const data = await db.read();
  return (data.incubators ?? []).find((inc) => inc.id === id) ?? null;
}

/* ─────────────────────────── Subscription lifecycle ─────────────────────────── */

/**
 * Whether the incubator's active FLAT subscription is still within the paid period.
 */
export function isSubscriptionActive(inc: IncubatorRecord): boolean {
  if (inc.subscriptionCode !== 'FLAT') return false;
  if (inc.subscriptionStatus !== 'ACTIVE') return false;
  if (!inc.subscriptionPeriodEnd) return false;
  return new Date(inc.subscriptionPeriodEnd) > new Date();
}
