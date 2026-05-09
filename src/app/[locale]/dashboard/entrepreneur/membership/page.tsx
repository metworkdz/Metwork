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

interface PageProps {
  params: Promise<{ locale: string }>;
}

const featureLabels: Record<string, string> = {
  'membership.features.profile': 'Public profile',
  'membership.features.browse': 'Browse spaces & programs',
  'membership.features.events': 'Attend events',
  'membership.features.allFree': 'Everything in Free',
  'membership.features.bookSpaces': 'Book coworking spaces',
  'membership.features.bookPrograms': 'Enroll in programs',
  'membership.features.eventsDiscount': 'Events at discounted rate',
  'membership.features.prioritySupport': 'Priority support',
  'membership.features.allEntrepreneur': 'Everything in Entrepreneur',
  'membership.features.listStartup': 'List your startup',
  'membership.features.fundraisingAccess': 'Access fundraising rounds',
  'membership.features.investorMeetings': 'Request investor meetings',
  'membership.features.featuredListing': 'Featured marketplace listing',
  'membership.features.consultations1': '1 free mentor session/month',
  'membership.features.consultations3': '3 free mentor sessions/month',
  'membership.features.spaceDiscount': '20% off space bookings',
};

const tierCopy: Record<string, { name: string; description: string }> = {
  FREE:         { name: 'Free',         description: 'Get started, browse the ecosystem.' },
  ENTREPRENEUR: { name: 'Entrepreneur', description: 'Book spaces, join programs, attend events.' },
  STARTUP:      { name: 'Startup',      description: 'Get listed, raise funds, meet investors.' },
};

export default async function EntrepreneurMembershipPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);
  const currentCode = getEffectiveMembershipCode(user);
  const expiresAt = user.membershipExpiresAt;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.membership.title')}
        subtitle={t('entrepreneur.membership.subtitle')}
      />

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
          const isDowngrade =
            (currentCode === 'STARTUP' && tier.code === 'ENTREPRENEUR') ||
            (currentCode !== 'FREE' && tier.code === 'FREE');

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
                    {tier.priceMonthly === 0 ? 'Free' : formatCurrency(tier.priceMonthly, lang)}
                  </span>
                  {tier.priceMonthly > 0 && (
                    <span className="text-sm text-muted-foreground">/month</span>
                  )}
                </div>
                {tier.priceMonthly > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    or {formatCurrency(Math.round(tier.priceYearly), lang)}/year
                    {'yearlyDiscountPercent' in tier && tier.yearlyDiscountPercent
                      ? ` — save ${tier.yearlyDiscountPercent}%`
                      : ''}
                  </p>
                )}
                <ul className="mt-5 space-y-2 text-sm">
                  {tier.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary-600" />
                      <span className="text-foreground">
                        {featureLabels[feat] ?? feat}
                      </span>
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
                  <button
                    className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-muted-foreground cursor-not-allowed opacity-50"
                    disabled
                  >
                    Downgrade
                  </button>
                ) : tier.priceMonthly > 0 ? (
                  <MembershipUpgradeButton
                    plan={tier.code as 'ENTREPRENEUR' | 'STARTUP'}
                    priceMonthly={tier.priceMonthly}
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

      <p className="text-xs text-muted-foreground">
        Plan changes will be wired to the wallet (or a payment provider) once the
        billing flow ships. Buttons are intentionally disabled.
      </p>
    </div>
  );
}
