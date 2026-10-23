/**
 * Display models for the membership plans.
 *
 * ONE source for every surface that renders plans — the public pricing page
 * and the entrepreneur and freelancer membership pages. Before this, the two files carried duplicate
 * hardcoded feature lists with a comment asking future editors to keep them in
 * sync by hand.
 *
 * Returns i18n *descriptors* (key + ICU values) rather than translated strings,
 * so this module stays free of request-scoped translation and each page renders
 * them in its own locale. The percentages and pass counts come from live
 * config, so admin edits flow into the copy without a code change.
 */
import { db } from '@/server/db/store';
import { isNetworkPassEnabled } from '@/config/feature-flags';
import {
  getMembershipPlanConfigs,
  pricesForConfig,
  passCountFrom,
} from '@/server/memberships/plan-config';
import type { CyclePrices } from '@/lib/billing-cycles';
import { purchasablePlansFor, type PaidPlanCode } from '@/lib/membership-benefits';

/** An i18n key plus the ICU values it interpolates. */
export interface FeatureDescriptor {
  key: string;
  values?: Record<string, number>;
  /**
   * Announced but not live yet. Rendered muted with a "Soon" tag, so a plan
   * never presents a benefit the product cannot deliver today as included.
   * Flip to live (drop the flag) in the phase that ships the feature.
   */
  soon?: boolean;
}

export type PlanViewCode = 'FREE' | PaidPlanCode;
export type PlanAudience = 'ENTREPRENEUR' | 'FREELANCER';

export interface MembershipPlanView {
  /** Store code — 'FREE' | 'STARTUP' (Founder) | 'FREELANCER_PREMIUM'. */
  code: PlanViewCode;
  /** i18n key for the plan name under the `membership` namespace. */
  nameKey: string;
  descriptionKey: string;
  prices: CyclePrices;
  consultationDiscountPercent: number;
  spaceDiscountPercent: number;
  monthlyPassCount: number;
  /** Carries the "Recommended" tag. At most one plan is ever true. */
  recommended: boolean;
  /** Can the viewer's audience buy it right now (see `purchasablePlansFor`)? */
  onSale: boolean;
  features: FeatureDescriptor[];
}

/**
 * Name + description keys for every plan code, including the retired
 * Entrepreneur plan that is no longer listed but still held by members until
 * it expires. The ONE place a plan code becomes a name.
 */
export const PLAN_COPY_KEYS: Record<PlanViewCode, { nameKey: string; descriptionKey: string }> = {
  FREE:               { nameKey: 'tiers.free.name',              descriptionKey: 'tiers.free.description' },
  ENTREPRENEUR:       { nameKey: 'tiers.entrepreneur.name',      descriptionKey: 'tiers.entrepreneur.description' },
  STARTUP:            { nameKey: 'tiers.startup.name',           descriptionKey: 'tiers.startup.description' },
  FREELANCER_PREMIUM: { nameKey: 'tiers.freelancerPremium.name', descriptionKey: 'tiers.freelancerPremium.description' },
};

const FREELANCER_FREE_COPY = {
  nameKey: 'tiers.freelancerFree.name',
  descriptionKey: 'tiers.freelancerFree.description',
};

const FREE_PRICES: CyclePrices = {
  monthly: 0,
  semesterly: 0,
  annual: 0,
  annualMonthlyEquivalent: 0,
  annualDiscountPercent: 0,
  semesterlyMonths: 6,
};

/**
 * The two plans an audience chooses between — Free and its paid plan — with
 * the newest config applied.
 *
 * Feature lists are assembled from live values, so an admin's edit to a rate
 * flows into the copy. Benefits from later Metwork 2.0 phases are listed with
 * `soon: true` until they ship.
 */
export async function getMembershipPlanViews(
  audience: PlanAudience = 'ENTREPRENEUR',
): Promise<MembershipPlanView[]> {
  const [configs, data] = await Promise.all([getMembershipPlanConfigs(), db.read()]);
  const paidCode: PaidPlanCode = audience === 'FREELANCER' ? 'FREELANCER_PREMIUM' : 'STARTUP';
  const paid = configs.find((c) => c.planCode === paidCode)!;
  const passes = passCountFrom(data, paidCode);
  const consult = Math.round(paid.consultationDiscountRate * 100);
  const space = Math.round(paid.spaceDiscountRate * 100);
  const onSale = purchasablePlansFor(audience).includes(paidCode);

  /**
   * Pass credits are advertised only when the plan actually grants some AND
   * the feature is live. Gating the ADVERTISEMENT here rather than at each card
   * means no surface can market a benefit the booking API would refuse.
   */
  const passFeature: FeatureDescriptor[] =
    isNetworkPassEnabled() && passes > 0 ? [{ key: 'networkPass', values: { count: passes } }] : [];

  if (audience === 'FREELANCER') {
    return [
      {
        code: 'FREE',
        ...FREELANCER_FREE_COPY,
        prices: FREE_PRICES,
        consultationDiscountPercent: 0,
        spaceDiscountPercent: 0,
        monthlyPassCount: 0,
        recommended: false,
        onSale: false,
        features: [
          { key: 'freelancerProfile' },
          { key: 'invoicingLimited' },
          { key: 'paymentLinksLimited' },
          { key: 'taxCalendar' },
          { key: 'copilotLimited' },
        ],
      },
      {
        code: 'FREELANCER_PREMIUM',
        ...PLAN_COPY_KEYS.FREELANCER_PREMIUM,
        prices: pricesForConfig(paid),
        consultationDiscountPercent: consult,
        spaceDiscountPercent: space,
        monthlyPassCount: 0,
        recommended: paid.recommended,
        onSale,
        features: [
          { key: 'verifiedBadge' },
          { key: 'consultationDiscount', values: { percent: consult } },
          { key: 'spaceDiscount', values: { percent: space } },
          { key: 'invoicingUnlimited' },
          { key: 'paymentLinksUnlimited' },
          { key: 'taxPrefill' },
          { key: 'perks', soon: true },
          { key: 'searchPriority', soon: true },
          { key: 'copilotUnlimited' },
        ],
      },
    ];
  }

  return [
    {
      code: 'FREE',
      ...PLAN_COPY_KEYS.FREE,
      prices: FREE_PRICES,
      consultationDiscountPercent: 0,
      spaceDiscountPercent: 0,
      monthlyPassCount: 0,
      recommended: false,
      onSale: false,
      features: [
        { key: 'profile' },
        { key: 'browse' },
        { key: 'events' },
        { key: 'taxCalendar' },
        { key: 'invoicingLimited', soon: true },
        { key: 'cofounderPreview', soon: true },
        { key: 'copilotLimited' },
      ],
    },
    {
      code: 'STARTUP',
      ...PLAN_COPY_KEYS.STARTUP,
      prices: pricesForConfig(paid),
      consultationDiscountPercent: consult,
      spaceDiscountPercent: space,
      monthlyPassCount: passes,
      recommended: paid.recommended,
      onSale,
      // Listed in full rather than leaning on an "everything in Free" line,
      // so the Founder benefit set reads completely on its own card.
      features: [
        { key: 'goldBadge' },
        { key: 'consultationDiscount', values: { percent: consult } },
        { key: 'spaceDiscount', values: { percent: space } },
        ...passFeature,
        { key: 'perks' },
        { key: 'exclusiveEvents' },
        { key: 'listStartup' },
        { key: 'fundraisingAccess' },
        { key: 'marketplaceFeature' },
        { key: 'cofounderMatching', soon: true },
        { key: 'invoicingUnlimited', soon: true },
        { key: 'copilotUnlimited' },
      ],
    },
  ];
}
