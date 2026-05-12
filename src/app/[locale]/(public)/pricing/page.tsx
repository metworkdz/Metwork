import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Check, ArrowRight, Zap } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { membershipTiers, incubatorSubscriptionTiers } from '@/config/memberships';
import { cn } from '@/lib/utils';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.pricing');
  return { title: t('title'), description: t('subtitle') };
}

function formatDZD(amount: number): string {
  return new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 0 }).format(amount);
}

export default async function PricingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tm, ti] = await Promise.all([
    getTranslations('pages.pricing'),
    getTranslations('membership'),
    getTranslations('incubator'),
  ]);

  // Map config data to display-ready tiers (explicit translation keys per tier)
  const displayTiers = [
    {
      code: 'FREE' as const,
      name: tm('tiers.free.name'),
      description: tm('tiers.free.description'),
      priceMonthly: membershipTiers[0].priceMonthly,
      priceYearly: membershipTiers[0].priceYearly,
      yearlyDiscount: 0,
      highlighted: false,
      features: [
        tm('features.profile'),
        tm('features.browse'),
        tm('features.events'),
      ],
    },
    {
      code: 'ENTREPRENEUR' as const,
      name: tm('tiers.entrepreneur.name'),
      description: tm('tiers.entrepreneur.description'),
      priceMonthly: membershipTiers[1].priceMonthly,
      priceYearly: membershipTiers[1].priceYearly,
      yearlyDiscount: 30,
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
      code: 'STARTUP' as const,
      name: tm('tiers.startup.name'),
      description: tm('tiers.startup.description'),
      priceMonthly: membershipTiers[2].priceMonthly,
      priceYearly: membershipTiers[2].priceYearly,
      yearlyDiscount: 30,
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

  const incubatorDisplayTiers = [
    {
      code: 'COMMISSION' as const,
      name: ti('subscription.commission.name'),
      description: ti('subscription.commission.description'),
      priceMonthly: incubatorSubscriptionTiers[0].priceMonthly,
    },
    {
      code: 'FLAT' as const,
      name: ti('subscription.flat.name'),
      description: ti('subscription.flat.description'),
      priceMonthly: incubatorSubscriptionTiers[1].priceMonthly,
    },
  ];

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

      {/* Membership tiers */}
      <section className="py-14 sm:py-20">
        <Container>
          <div className="grid gap-6 md:grid-cols-3">
            {displayTiers.map((tier) => {
              const isFree = tier.code === 'FREE';

              return (
                <Card
                  key={tier.code}
                  className={cn(
                    'relative flex flex-col overflow-hidden border-border/60 transition-all',
                    tier.highlighted && 'border-primary shadow-lg shadow-primary/10',
                  )}
                >
                  {tier.highlighted && (
                    <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary-500 to-primary-700" />
                  )}

                  <CardContent className="flex flex-1 flex-col p-8">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-display text-xl font-bold uppercase tracking-wide text-foreground">
                          {tier.name}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
                      </div>
                      {tier.highlighted && (
                        <Badge variant="primary" className="shrink-0 text-xs">
                          {t('mostPopular')}
                        </Badge>
                      )}
                    </div>

                    {/* Price */}
                    <div className="mt-8">
                      {isFree ? (
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-display text-4xl font-bold text-foreground">
                            {tm('tiers.free.name')}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-display text-4xl font-bold text-foreground">
                              {formatDZD(tier.priceMonthly)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              DZD {tm('perMonth')}
                            </span>
                          </div>
                          {tier.yearlyDiscount > 0 && (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              {tm('yearlySaveBadge', { percent: tier.yearlyDiscount })} billed
                              annually
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {/* CTA */}
                    <Button
                      asChild
                      size="lg"
                      variant={tier.highlighted ? 'default' : 'outline'}
                      className={cn(
                        'mt-6 w-full rounded-full text-sm font-semibold',
                        tier.highlighted && 'font-bold uppercase tracking-wider',
                      )}
                    >
                      <Link href="/signup">
                        {isFree ? tm('choosePlan') : tm('upgrade')}
                        <ArrowRight className="size-4 rtl:rotate-180" />
                      </Link>
                    </Button>

                    {/* Features */}
                    <ul className="mt-8 space-y-3">
                      {tier.features.map((label) => (
                        <li key={label} className="flex items-start gap-3">
                          <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                            <Check className="size-2.5" strokeWidth={3} />
                          </div>
                          <span className="text-sm text-muted-foreground">{label}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>

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
      <section className="border-t border-border/60 bg-muted/25 py-14 sm:py-20">
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

          <div className="mx-auto mt-10 grid max-w-2xl gap-6 sm:grid-cols-2">
            {incubatorDisplayTiers.map((tier) => (
              <Card
                key={tier.code}
                className="flex flex-col border-border/60 transition-all hover:border-primary-200 hover:shadow-md"
              >
                <CardContent className="flex flex-1 flex-col p-8">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide text-foreground">
                    {tier.name}
                  </h3>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">{tier.description}</p>

                  <div className="mt-6 flex items-baseline gap-1.5">
                    <span className="font-display text-3xl font-bold text-foreground">
                      {tier.priceMonthly === 0 ? '0' : formatDZD(tier.priceMonthly)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      DZD {tm('perMonth')}
                    </span>
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
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
