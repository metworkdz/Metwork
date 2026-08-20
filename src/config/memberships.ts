/**
 * Static platform pricing config.
 *
 * Entrepreneur membership tiers USED to live here as a hardcoded table. They
 * are now DB-backed and admin-editable — see `membershipPlanConfigs` in the
 * store, `@/server/memberships/plan-config` for reads, and
 * `@/lib/membership-benefits` for the shipped defaults. Nothing about
 * entrepreneur membership pricing belongs in this file any more.
 *
 * All prices in DZD (Algerian Dinar).
 */

/**
 * Incubator subscription model (the "Pro" plan).
 * Either pay 5000 DZD/month (billed monthly or yearly at 30 % off) OR give
 * 5 % commission per booking. Incubator chooses one and can switch anytime.
 */
export const incubatorSubscriptionTiers = [
  {
    code: 'COMMISSION',
    nameKey: 'incubator.subscription.commission.name',
    descriptionKey: 'incubator.subscription.commission.description',
    priceMonthly: 0,
    commissionRate: 0.05, // 5%
  },
  {
    code: 'FLAT',
    nameKey: 'incubator.subscription.flat.name',
    descriptionKey: 'incubator.subscription.flat.description',
    priceMonthly: 5000,
    priceYearly: Math.round(5000 * 12 * 0.7), // 42 000 DZD, 30 % off
    commissionRate: 0,
  },
] as const;

export const platformCommissions = {
  /** % Metwork takes from each investment */
  investment: 0.07,
  /** Default % Metwork takes from incubator bookings (when incubator is on COMMISSION plan) */
  incubatorBooking: 0.05,
} as const;
