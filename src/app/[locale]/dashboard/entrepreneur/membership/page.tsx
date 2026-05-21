import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Check, Star } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { formatCurrency } from '@/lib/format';
import { membershipTiers } from '@/config/memberships';
import { MembershipPromoSection } from '@/components/features/membership/membership-promo-section';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import { MembershipUpgradeButton } from '@/components/features/entrepreneur/membership-upgrade-button';
import { MembershipDowngradeButton } from '@/components/features/entrepreneur/membership-downgrade-button';
import { ScheduledDowngradeBanner } from '@/components/features/entrepreneur/scheduled-downgrade-banner';
import { getEffectiveMembershipCode } from '@/server/memberships/service';

interface PageProps {
  params: Promise<{ locale: string }>;
}

const tierCopy: Record<string, { name: string; description: string }> = {
  FREE:         { name: 'Explorer',     description: 'Get started, browse the ecosystem.' },
  ENTREPRENEUR: { name: 'Builder',      description: 'Book spaces, join programs, attend events.' },
  STARTUP:      { name: 'Founder',      description: 'Get listed, raise funds, meet investors.' },
};

// Tier ranking — higher = more premium. Used to decide upgrade vs downgrade.
const TIER_RANK: Record<string, number> = { FREE: 0, ENTREPRENEUR: 1, STARTUP: 2 };

export default async function EntrepreneurMembershipPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const tm = await getTranslations('membership');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);
  const currentCode = getEffectiveMembershipCode(user);
  const expiresAt = user.membershipExpiresAt;
  const scheduledChange = user.scheduledMembershipChange ?? null;
  const scheduledDate = user.scheduledChangeDate ?? null;

  // Feature lists for each tier — mirrors src/app/[locale]/(public)/pricing/page.tsx
  // exactly, so the dashboard view stays consistent with the marketing page.
  const tierFeatures: Record<string, string[]> = {
    FREE: [
      tm('features.profile'),
      tm('features.browse'),
      tm('features.events'),
    ],
    ENTREPRENEUR: [
      tm('features.allFree'),
      tm('features.bookPrograms'),
      tm('features.networkPass3'),
      tm('features.bookSpaces'),
      tm('features.eventsDiscount'),
      tm('features.prioritySupport'),
    ],
    STARTUP: [
      tm('features.allEntrepreneur'),
      tm('features.freeConsultations3'),
      tm('features.networkPass10'),
      tm('features.spaceDiscount20'),
      tm('features.listStartup'),
      tm('features.fundraisingAccess'),
      tm('features.investorMeetings'),
      tm('features.featuredListing'),
    ],
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
          targetName={tierCopy[scheduledChange]?.name ?? scheduledChange}
          scheduledDate={scheduledDate}
          locale={lang}
        />
      )}

      {/* Current plan card */}
      <Card className="border-primary-200 bg-primary-50/40">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">Current plan</p>
            <p className="mt-1 text-xl font-semibold">{tierCopy[currentCode]?.name ?? currentCode}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tierCopy[currentCode]?.description}
            </p>
            {expiresAt && currentCode !== 'FREE' && (
              <p className="mt-1 text-xs text-muted-foreground">
                Renews on {new Date(expiresAt).toLocaleDateString(lang, { dateStyle: 'medium' })}
              </p>
            )}
          </div>
          {currentCode !== 'STARTUP' && (
            <Badge variant="primary">Upgrade available</Badge>
          )}
        </CardContent>
      </Card>

      {/* Tier cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {membershipTiers.map((tier) => {
          const isCurrent = tier.code === currentCode;
          const isHighlighted = 'highlighted' in tier && tier.highlighted === true;
          const copy = tierCopy[tier.code] ?? { name: tier.code, description: '' };
          const currentRank = TIER_RANK[currentCode] ?? 0;
          const targetRank = TIER_RANK[tier.code] ?? 0;
          const isDowngrade = targetRank < currentRank;
          const isUpgrade = targetRank > currentRank;
          const features = tierFeatures[tier.code] ?? [];

          return (
            <Card
              key={tier.code}
              className={cn(
                'relative flex flex-col',
                isHighlighted && 'border-primary-300 shadow-md',
              )}
            >
              {isHighlighted && (
                <div className="absolute -top-3 start-6">
                  <Badge variant="primary" className="gap-1">
                    <Star className="size-3" />
                    Most popular
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
                    {tier.priceMonthly === 0 ? tm('tiers.free.name') : formatCurrency(tier.priceMonthly, lang)}
                  </span>
                  {tier.priceMonthly > 0 && (
                    <span className="text-sm text-muted-foreground">{tm('perMonth')}</span>
                  )}
                </div>
                {tier.priceMonthly > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tm('billedSemesterlyOrYearly', {
                      yearly: formatCurrency(Math.round(tier.priceYearly), lang),
                      percent:
                        'yearlyDiscountPercent' in tier && tier.yearlyDiscountPercent
                          ? tier.yearlyDiscountPercent
                          : 30,
                    })}
                  </p>
                )}
                <ul className="mt-5 space-y-2 text-sm">
                  {features.map((label) => (
                    <li key={label} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary-600" />
                      <span className="text-foreground">{label}</span>
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
                    Current plan
                  </button>
                ) : isDowngrade ? (
                  <MembershipDowngradeButton
                    targetPlan={tier.code as 'ENTREPRENEUR' | 'FREE'}
                    targetName={copy.name}
                    scheduledDate={expiresAt ?? null}
                    locale={lang}
                    alreadyScheduled={scheduledChange === tier.code}
                  />
                ) : isUpgrade && tier.priceMonthly > 0 ? (
                  <MembershipUpgradeButton
                    plan={tier.code as 'ENTREPRENEUR' | 'STARTUP'}
                    priceMonthly={tier.priceMonthly}
                    priceSemesterly={'priceSemesterly' in tier ? tier.priceSemesterly : tier.priceMonthly * 6}
                    priceYearly={Math.round(tier.priceYearly)}
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
        const tiers = membershipTiers as ReadonlyArray<{ code: string; priceMonthly: number }>;
        const currentIdx = tiers.findIndex((t) => t.code === currentCode);
        const nextTier = tiers[currentIdx + 1];
        if (!nextTier || nextTier.priceMonthly === 0) return null;
        const nextCopy = tierCopy[nextTier.code] ?? { name: nextTier.code, description: '' };
        return (
          <MembershipPromoSection
            nextTierPrice={nextTier.priceMonthly}
            nextTierName={nextCopy.name}
            locale={lang}
          />
        );
      })()}
    </div>
  );
}
