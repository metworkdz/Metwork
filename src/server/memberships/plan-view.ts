/**
 * Display models for the membership plans.
 *
 * ONE source for both surfaces that render plans — the public pricing page and
 * the entrepreneur dashboard. Before this, the two files carried duplicate
 * hardcoded feature lists with a comment asking future editors to keep them in
 * sync by hand.
 *
 * Returns i18n *descriptors* (key + ICU values) rather than translated strings,
 * so this module stays free of request-scoped translation and each page renders
 * them in its own locale. The percentages and pass counts come from live
 * config, so admin edits flow into the copy without a code change.
 */
import { db } from '@/server/db/store';
import {
  getMembershipPlanConfigs,
  pricesForConfig,
  passCountFrom,
} from '@/server/memberships/plan-config';
import type { CyclePrices } from '@/lib/billing-cycles';

/** An i18n key plus the ICU values it interpolates. */
export interface FeatureDescriptor {
  key: string;
  values?: Record<string, number>;
}

export interface MembershipPlanView {
  /** Store code — 'FREE' | 'ENTREPRENEUR' (Builder) | 'STARTUP' (Founder). */
  code: 'FREE' | 'ENTREPRENEUR' | 'STARTUP';
  /** i18n key for the plan name, e.g. `membership.tiers.entrepreneur.name`. */
  nameKey: string;
  descriptionKey: string;
  prices: CyclePrices;
  consultationDiscountPercent: number;
  spaceDiscountPercent: number;
  monthlyPassCount: number;
  /** Carries the "Recommended" tag. At most one plan is ever true. */
  recommended: boolean;
  features: FeatureDescriptor[];
}

const FREE_PRICES: CyclePrices = {
  monthly: 0,
  semesterly: 0,
  annual: 0,
  annualMonthlyEquivalent: 0,
  annualDiscountPercent: 0,
  semesterlyMonths: 6,
};

/**
 * Build the display model for all three tiers, newest config applied.
 *
 * Feature lists are assembled from live values, so a plan with 0 coworking
 * passes simply does not advertise passes — no UI anywhere has to special-case
 * "Builder has none".
 */
export async function getMembershipPlanViews(): Promise<MembershipPlanView[]> {
  const [configs, data] = await Promise.all([getMembershipPlanConfigs(), db.read()]);

  const builder = configs.find((c) => c.planCode === 'ENTREPRENEUR')!;
  const founder = configs.find((c) => c.planCode === 'STARTUP')!;

  const builderPasses = passCountFrom(data, 'ENTREPRENEUR');
  const founderPasses = passCountFrom(data, 'STARTUP');

  const builderConsult = Math.round(builder.consultationDiscountRate * 100);
  const builderSpace   = Math.round(builder.spaceDiscountRate * 100);
  const founderConsult = Math.round(founder.consultationDiscountRate * 100);
  const founderSpace   = Math.round(founder.spaceDiscountRate * 100);

  /** Pass credits are advertised only when the plan actually grants some. */
  const passFeature = (count: number): FeatureDescriptor[] =>
    count > 0 ? [{ key: 'networkPass', values: { count } }] : [];

  return [
    {
      code: 'FREE',
      nameKey: 'tiers.free.name',
      descriptionKey: 'tiers.free.description',
      prices: FREE_PRICES,
      consultationDiscountPercent: 0,
      spaceDiscountPercent: 0,
      monthlyPassCount: 0,
      recommended: false,
      features: [{ key: 'profile' }, { key: 'browse' }, { key: 'events' }],
    },
    {
      code: 'ENTREPRENEUR',
      nameKey: 'tiers.entrepreneur.name',
      descriptionKey: 'tiers.entrepreneur.description',
      prices: pricesForConfig(builder),
      consultationDiscountPercent: builderConsult,
      spaceDiscountPercent: builderSpace,
      monthlyPassCount: builderPasses,
      recommended: builder.recommended,
      features: [
        { key: 'allFree' },
        { key: 'consultationDiscount', values: { percent: builderConsult } },
        { key: 'spaceDiscount', values: { percent: builderSpace } },
        ...passFeature(builderPasses),
        { key: 'perks' },
        { key: 'exclusiveEvents' },
      ],
    },
    {
      code: 'STARTUP',
      nameKey: 'tiers.startup.name',
      descriptionKey: 'tiers.startup.description',
      prices: pricesForConfig(founder),
      consultationDiscountPercent: founderConsult,
      spaceDiscountPercent: founderSpace,
      monthlyPassCount: founderPasses,
      recommended: founder.recommended,
      // Listed in full rather than leaning on an "everything in Builder" line,
      // so the Founder benefit set reads completely on its own card.
      features: [
        { key: 'consultationDiscount', values: { percent: founderConsult } },
        { key: 'spaceDiscount', values: { percent: founderSpace } },
        ...passFeature(founderPasses),
        { key: 'perks' },
        { key: 'exclusiveEvents' },
        { key: 'listStartup' },
        { key: 'fundraisingAccess' },
        { key: 'marketplaceFeature' },
      ],
    },
  ];
}
