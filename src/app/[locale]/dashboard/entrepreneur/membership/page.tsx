import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Check, Star } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { formatCurrency } from '@/lib/format';
import { getMembershipPlanViews } from '@/server/memberships/plan-view';
import { MembershipPromoSection } from '@/components/features/membership/membership-promo-section';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import { MembershipUpgradeButton } from '@/components/features/entrepreneur/membership-upgrade-button';
import { MembershipDowngradeButton } from '@/components/features/entrepreneur/membership-downgrade-button';
import { ScheduledDowngradeBanner } from '@/components/features/entrepreneur/scheduled-downgrade-banner';
import { getEffectiveMembershipCode } from '@/server/memberships/service';
import { normalizePlanCode } from '@/lib/membership-benefits';

interface PageProps {
  params: Promise<{ locale: string }>;
}

// Tier ranking — higher = more premium. Used to decide upgrade vs downgrade.
// Keyed by every value getEffectiveMembershipCode can return.
const TIER_RANK: Record<string, number> = {
  FREE: 0,
  ENTREPRENEUR: 1,
  BUILDER: 1,
  STARTUP: 2,
  FOUNDER: 2,
};

export default async function EntrepreneurMembershipPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const tm = await getTranslations('membership');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);
  const currentCode = getEffectiveMembershipCode(user);
  // Rank comparisons (not string equality) so BUILDER/FOUNDER codes match
  // their ENTREPRENEUR/STARTUP tier cards.
  const currentRank = TIER_RANK[currentCode] ?? 0;
  const expiresAt = user.membershipExpiresAt;
  const scheduledChange = user.scheduledMembershipChange ?? null;
  const scheduledDate = user.scheduledChangeDate ?? null;

  // Plans come from the ONE shared view model that the public pricing page
  // also uses, so the two can no longer drift.
  const planViews = await getMembershipPlanViews();

  /**
   * Plan name + description for a stored code, in the reader's locale.
   *
   * This page used to carry its own English `tierCopy` map, so the dashboard
   * showed English plan names to French and Arabic readers while the pricing
   * page one click away showed translated ones. Resolving through the shared
   * view model keeps a single set of names — and one place to rename them.
   *
   * Accepts every spelling `getEffectiveMembershipCode` can return: the tier
   * field still carries the plans' former names (BUILDER / FOUNDER).
   */
  const copyFor = (codeOrTier: string): { name: string; description: string } => {
    const code = normalizePlanCode(codeOrTier) ?? 'FREE';
    const view = planViews.find((p) => p.code === code);
    if (!view) return { name: codeOrTier, description: '' };
    return { name: tm(view.nameKey), description: tm(view.descriptionKey) };
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.membership.title')}
        subtitle={t('entrepreneur.membership.subtitle')}
      />

      {/* Scheduled downgrade banner */}
      {scheduledChange && scheduledDate && (
        <ScheduledDowngradeBanner
          targetName={copyFor(scheduledChange).name}
          scheduledDate={scheduledDate}
          locale={lang}
        />
      )}

      {/* Current plan card */}
      <Card className="border-primary-200 bg-primary-50/40">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">{tm('currentPlanLabel')}</p>
            <p className="mt-1 text-xl font-semibold">{copyFor(currentCode).name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {copyFor(currentCode).description}
            </p>
            {expiresAt && currentCode !== 'FREE' && (
              <p className="mt-1 text-xs text-muted-foreground">
                {tm('renewsOn', {
                  date: new Date(expiresAt).toLocaleDateString(lang, { dateStyle: 'medium' }),
                })}
              </p>
            )}
          </div>
          {currentRank < (TIER_RANK.STARTUP ?? 2) && (
            <Badge variant="primary">{tm('upgradeAvailable')}</Badge>
          )}
        </CardContent>
      </Card>

      {/* Tier cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {planViews.map((plan) => {
          const targetRank = TIER_RANK[plan.code] ?? 0;
          const isCurrent = targetRank === currentRank;
          const isHighlighted = plan.recommended;
          const copy = copyFor(plan.code);
          const isDowngrade = targetRank < currentRank;
          const isUpgrade = targetRank > currentRank;
          const isPaid = plan.prices.monthly > 0;

          return (
            <Card
              key={plan.code}
              className={cn(
                'relative flex flex-col',
                isHighlighted && 'border-primary-300 shadow-md',
              )}
            >
              {isHighlighted && (
                <div className="absolute -top-3 start-6">
                  <Badge variant="primary" className="gap-1">
                    <Star className="size-3" />
                    {tm('recommended')}
                  </Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{copy.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{copy.description}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">
                    {isPaid ? formatCurrency(plan.prices.monthly, lang) : tm('priceFree')}
                  </span>
                  {isPaid && <span className="text-sm text-muted-foreground">{tm('perMonth')}</span>}
                </div>
                {isPaid && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tm('billedSemesterlyOrYearly', {
                      yearly: formatCurrency(plan.prices.annual, lang),
                      percent: plan.prices.annualDiscountPercent,
                    })}
                  </p>
                )}
                <ul className="mt-5 space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f.key} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary-600" />
                      <span className="text-foreground">{tm(`features.${f.key}`, f.values)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {isCurrent ? (
                  <button
                    className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium opacity-50 cursor-not-allowed"
                    disabled
                  >
                    {tm('currentPlanLabel')}
                  </button>
                ) : isDowngrade ? (
                  <MembershipDowngradeButton
                    targetPlan={plan.code as 'ENTREPRENEUR' | 'FREE'}
                    targetName={copy.name}
                    scheduledDate={expiresAt ?? null}
                    locale={lang}
                    alreadyScheduled={scheduledChange === plan.code}
                  />
                ) : isUpgrade && isPaid ? (
                  <MembershipUpgradeButton
                    plan={plan.code as 'ENTREPRENEUR' | 'STARTUP'}
                    priceMonthly={plan.prices.monthly}
                    priceSemesterly={plan.prices.semesterly}
                    priceYearly={plan.prices.annual}
                    planName={copy.name}
                    highlighted={isHighlighted}
                    locale={lang}
                  />
                ) : null}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Promo code preview — shown when an upgrade is available */}
      {(() => {
        const currentIdx = planViews.findIndex((p) => (TIER_RANK[p.code] ?? 0) === currentRank);
        const nextTier = planViews[currentIdx + 1];
        if (!nextTier || nextTier.prices.monthly === 0) return null;
        const nextCopy = copyFor(nextTier.code);
        return (
          <MembershipPromoSection
            nextTierPrice={nextTier.prices.monthly}
            nextTierName={nextCopy.name}
            locale={lang}
          />
        );
      })()}
    </div>
  );
}
