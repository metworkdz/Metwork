/**
 * Default membership tiers.
 *
 * IMPORTANT: These are *seed values*. The actual prices and features
 * are stored in the `memberships` table and editable from the admin
 * dashboard. This file is the source of truth for the initial migration
 * and the type definitions consumed by the UI.
 *
 * All prices in DZD (Algerian Dinar).
 */
export const membershipTiers = [
  {
    code: 'FREE',
    nameKey: 'membership.tiers.free.name',
    descriptionKey: 'membership.tiers.free.description',
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      'membership.features.profile',
      'membership.features.browse',
      'membership.features.events',
    ],
    canListStartup: false,
    canAccessMarketplace: false,
  },
  {
    code: 'ENTREPRENEUR',
    nameKey: 'membership.tiers.entrepreneur.name',
    descriptionKey: 'membership.tiers.entrepreneur.description',
    priceMonthly: 3500,
    priceSemesterly: 3500 * 6, // billed every 6 months, no discount
    priceYearly: Math.round(3500 * 12 * 0.7), // 30% yearly discount
    yearlyDiscountPercent: 30,
    features: [
      'membership.features.allFree',
      'membership.features.bookSpaces',
      'membership.features.bookPrograms',
      'membership.features.eventsDiscount',
      'membership.features.prioritySupport',
    ],
    canListStartup: false,
    canAccessMarketplace: true,
    highlighted: false,
  },
  {
    code: 'STARTUP',
    nameKey: 'membership.tiers.startup.name',
    descriptionKey: 'membership.tiers.startup.description',
    priceMonthly: 6500,
    priceSemesterly: 6500 * 6, // billed every 6 months, no discount
    priceYearly: Math.round(6500 * 12 * 0.7),
    yearlyDiscountPercent: 30,
    features: [
      'membership.features.allEntrepreneur',
      'membership.features.listStartup',
      'membership.features.fundraisingAccess',
      'membership.features.investorMeetings',
      'membership.features.featuredListing',
    ],
    canListStartup: true,
    canAccessMarketplace: true,
    highlighted: true,
  },
] as const;

export type MembershipCode = (typeof membershipTiers)[number]['code'];

/**
 * Incubator subscription model (the "Pro" plan).
 * Either pay 5000 DZD/month (billed monthly or yearly at 30 % off) OR give
 * 20 % commission per booking. Incubator chooses one and can switch anytime.
 */
export const incubatorSubscriptionTiers = [
  {
    code: 'COMMISSION',
    nameKey: 'incubator.subscription.commission.name',
    descriptionKey: 'incubator.subscription.commission.description',
    priceMonthly: 0,
    commissionRate: 0.2, // 20%
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
  incubatorBooking: 0.2,
} as const;
