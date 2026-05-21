/**
 * Incubator server-side helpers.
 *
 * Subscription pricing (the "Pro" / FLAT plan):
 *   FLAT / MONTHLY — flatMonthlyPrice (default 5 000 DZD), charged each cycle
 *   FLAT / YEARLY  — monthly × 12 × (1 − yearlyDiscount%) = 42 000 DZD default
 *   COMMISSION     — no subscription fee; platform takes commissionRate on bookings
 *
 * Monthly Pro is debited from the incubator owner's wallet each cycle by the
 * billing cron (`/api/cron/incubator-billing`). Yearly Pro is paid upfront and
 * reverts to COMMISSION at read-time once the paid period lapses. The first-ever
 * Pro activation grants one free month (tracked via `proTrialUsedAt`).
 *
 * All prices sourced from db.meta.platformConfig (admin-editable), falling
 * back to defaultPlatformConfig if not yet set.
 */
import {
  db,
  type IncubatorRecord,
  type IncubatorBillingCycle,
  type IncubatorSubscription,
  defaultPlatformConfig,
  type PlatformConfig,
} from '@/server/db/store';

/* ─────────────────────────── Config helpers ─────────────────────────── */

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const data = await db.read();
  return { ...defaultPlatformConfig, ...data.meta?.platformConfig };
}

/* ─────────────────────────── Pricing helpers ─────────────────────────── */

export interface SubscriptionPricing {
  /** Charged for one month on the MONTHLY cycle. */
  monthlyAmount: number;
  /** Charged once for a full year on the YEARLY cycle (discounted). */
  yearlyAmount: number;
  /** Per-month display figure shown for the YEARLY plan (yearly ÷ 12). */
  yearlyMonthlyEquivalent: number;
  yearlyDiscountPercent: number;
}

export function computeSubscriptionPricing(cfg: PlatformConfig): SubscriptionPricing {
  const { flatMonthlyPrice, yearlyDiscountPercent } = cfg;
  const yearlyAmount = Math.round(flatMonthlyPrice * 12 * (1 - yearlyDiscountPercent / 100));
  return {
    monthlyAmount: flatMonthlyPrice,
    yearlyAmount,
    yearlyMonthlyEquivalent: Math.round(yearlyAmount / 12),
    yearlyDiscountPercent,
  };
}

/** Compute the period-end date from a subscription start + billing cycle. */
export function computePeriodEnd(start: string, billingCycle: IncubatorBillingCycle): string {
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + (billingCycle === 'YEARLY' ? 12 : 1));
  return d.toISOString();
}

/* ─────────────────────────── Incubator lookup ─────────────────────────── */

/**
 * Find the incubator record linked to the logged-in INCUBATOR user.
 *
 * Strategy:
 *  1. Match by inc.email (new records created after the email field was added).
 *  2. Fall back to matching by inc.managerId via the users table (records
 *     created before email was stored on the incubator record — i.e. all
 *     registrations prior to this fix).
 *
 * Returns null only when no incubator record exists for this user at all.
 */
export async function findIncubatorByUserEmail(email: string): Promise<IncubatorRecord | null> {
  const data = await db.read();
  const incubators = data.incubators ?? [];

  // 1. Try direct email match (fastest path for new records)
  const byEmail = incubators.find((inc) => inc.email === email);
  if (byEmail) return byEmail;

  // 2. Resolve user → managerId lookup (covers legacy records without email)
  const user = (data.users ?? []).find((u) => u.email === email);
  if (!user) return null;

  const byManager = incubators.find((inc) => inc.managerId === user.id);
  // Back-fill the email field so future lookups hit the fast path
  if (byManager && !byManager.email) {
    // Fire-and-forget — non-blocking migration
    void import('@/server/db/store').then(({ db: store }) =>
      store.update((d) => {
        const rec = (d.incubators ?? []).find((i) => i.id === byManager.id);
        if (rec && !rec.email) rec.email = email;
      }),
    );
  }
  return byManager ?? null;
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

/**
 * The incubator's *effective* billing model, applying read-time expiry.
 *
 * Returns 'FLAT' only while a paid (or trial) FLAT period is still running;
 * otherwise 'COMMISSION'. This mirrors the lazy membership-expiry pattern, so
 * an expired Pro plan automatically reverts to commission for revenue,
 * payment-method gating, etc. — without needing a sweep to flip the stored code.
 */
export function getEffectiveSubscriptionCode(inc: IncubatorRecord): IncubatorSubscription {
  return isSubscriptionActive(inc) ? 'FLAT' : 'COMMISSION';
}

/**
 * Whether this incubator is on the *monthly* Pro plan and therefore subject to
 * recurring wallet billing + the minimum-balance withdrawal guard. Yearly Pro
 * and commission incubators are NOT subject.
 */
export function isMonthlyFlatActive(inc: IncubatorRecord): boolean {
  return isSubscriptionActive(inc) && inc.billingCycle === 'MONTHLY';
}
