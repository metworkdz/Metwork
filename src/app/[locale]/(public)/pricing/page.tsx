import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowRight, Zap, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  MembershipPlans,
  type MembershipPlanCard,
} from '@/components/features/membership/membership-plans';
import { membershipTiers, incubatorSubscriptionTiers } from '@/config/memberships';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { assertLandingVisible } from '@/lib/landing-visibility';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.pricing');
  return { title: t('title'), description: t('subtitle') };
}

export default async function PricingPage({ params }: PageProps) {
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('pricing');
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = locale as Locale;

  const [t, tm, ti] = await Promise.all([
    getTranslations('pages.pricing'),
    getTranslations('membership'),
    getTranslations('incubator'),
  ]);

  // Map config data to display-ready entrepreneur tiers (explicit keys per tier).
  const tiers: MembershipPlanCard[] = [
    {
      code: 'FREE',
      name: tm('tiers.free.name'),
      description: tm('tiers.free.description'),
      priceMonthly: membershipTiers[0].priceMonthly,
      priceSemesterly: membershipTiers[0].priceMonthly * 6,
      priceYearly: membershipTiers[0].priceYearly,
      yearlyDiscountPercent: 0,
      highlighted: false,
      features: [tm('features.profile'), tm('features.browse'), tm('features.events')],
    },
    {
      code: 'ENTREPRENEUR',
      name: tm('tiers.entrepreneur.name'),
      description: tm('tiers.entrepreneur.description'),
      priceMonthly: membershipTiers[1].priceMonthly,
      priceSemesterly: membershipTiers[1].priceSemesterly,
      priceYearly: membershipTiers[1].priceYearly,
      yearlyDiscountPercent: membershipTiers[1].yearlyDiscountPercent,
      highlighted: false,
      features: [
        tm('features.allFree'),
        tm('features.bookPrograms'),
        tm('features.networkPass3'),
        tm('features.bookSpaces'),
        tm('features.eventsDiscount'),
        tm('features.prioritySupport'),
      ],
    },
    {
      code: 'STARTUP',
      name: tm('tiers.startup.name'),
      description: tm('tiers.startup.description'),
      priceMonthly: membershipTiers[2].priceMonthly,
      priceSemesterly: membershipTiers[2].priceSemesterly,
      priceYearly: membershipTiers[2].priceYearly,
      yearlyDiscountPercent: membershipTiers[2].yearlyDiscountPercent,
      highlighted: true,
      features: [
        tm('features.allEntrepreneur'),
        tm('features.freeConsultations3'),
        tm('features.networkPass10'),
        tm('features.spaceDiscount20'),
        tm('features.listStartup'),
        tm('features.fundraisingAccess'),
        tm('features.investorMeetings'),
        tm('features.featuredListing'),
      ],
    },
  ];

  const commissionTier = incubatorSubscriptionTiers[0];
  const proTier = incubatorSubscriptionTiers[1];
  const commissionPercent = Math.round(commissionTier.commissionRate * 100);
  const proYearly = proTier.priceYearly;

  return (
    <>
      {/* Hero */}
      <section className="border-b border-border/60 bg-gradient-to-b from-primary-50/60 to-background">
        <Container>
          <div className="flex flex-col items-center py-14 text-center sm:py-20">
            <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl lg:text-5xl">
              {t('title')}
            </h1>
            <p className="mt-4 max-w-md text-balance text-base text-muted-foreground sm:text-lg">
              {t('subtitle')}
            </p>
          </div>
        </Container>
      </section>

      {/* Entrepreneur memberships */}
      <section className="py-14 sm:py-20">
        <Container>
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
              {t('entrepreneurTitle')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground">{t('entrepreneurSubtitle')}</p>
          </div>

          <MembershipPlans tiers={tiers} locale={lang} mostPopularLabel={t('mostPopular')} />

          {/* FAQ link */}
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t('faq')}{' '}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              {t('faqLink')}
            </Link>
          </p>
        </Container>
      </section>

      {/* Incubator plans */}
      <section
        id="incubator"
        className="scroll-mt-20 border-t border-border/60 bg-muted/25 py-14 sm:py-20"
      >
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex size-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
              <Zap className="size-5" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold uppercase tracking-tight sm:text-3xl">
              {t('incubatorTitle')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground">{t('incubatorSubtitle')}</p>
          </div>

          <div className="mx-auto mt-10 grid max-w-2xl items-stretch gap-6 sm:grid-cols-2">
            {/* Pay-as-you-go (commission) */}
            <Card className="flex flex-col border-border/60 transition-all hover:border-primary-200 hover:shadow-md">
              <CardContent className="flex flex-1 flex-col p-8">
                <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                  {ti('subscription.commission.name')}
                </h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">
                  {ti('subscription.commission.description')}
                </p>

                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-bold text-foreground">
                    {commissionPercent}%
                  </span>
                  <span className="text-sm text-muted-foreground">{t('perBooking')}</span>
                </div>

                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="mt-6 w-full rounded-full text-sm font-semibold"
                >
                  <Link href="/signup">
                    {tm('choosePlan')}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Pro (flat subscription) */}
            <Card className="relative flex flex-col overflow-hidden border-primary shadow-lg shadow-primary/10">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary-500 to-primary-700" />
              <CardContent className="flex flex-1 flex-col p-8">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                    {ti('subscription.flat.name')}
                  </h3>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">
                    <Sparkles className="size-3" />
                    {t('incubatorProTrial')}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">
                  {ti('subscription.flat.description')}
                </p>

                <div className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-bold text-foreground">
                    {formatCurrency(proTier.priceMonthly, lang)}
                  </span>
                  <span className="text-sm text-muted-foreground">{tm('perMonth')}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('incubatorBilledYearly', {
                    yearly: formatCurrency(proYearly, lang),
                    percent: 30,
                  })}
                </p>

                <Button
                  asChild
                  size="lg"
                  className="mt-6 w-full rounded-full text-sm font-bold uppercase tracking-wider"
                >
                  <Link href="/signup">
                    {t('incubatorProCta')}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </Container>
      </section>
    </>
  );
}
