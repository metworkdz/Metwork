'use client';

import { useState } from 'react';
import { Check, ArrowRight, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

export interface MembershipPlanCard {
  code: string;
  name: string;
  description: string;
  /** Charged each month on the monthly cycle. */
  priceMonthly: number;
  /** Full amount charged for twelve months (discounted). */
  priceYearly: number;
  yearlyDiscountPercent: number;
  highlighted: boolean;
  features: { label: string; soon?: boolean }[];
}

interface Props {
  tiers: MembershipPlanCard[];
  locale: Locale;
  mostPopularLabel: string;
  /** Where the CTA sends a visitor (the audience's signup page). */
  ctaHref: string;
}

type BillingPeriod = 'monthly' | 'yearly';

/** Public plan cards: Free + one paid plan, monthly or yearly. */
export function MembershipPlans({ tiers, locale, mostPopularLabel, ctaHref }: Props) {
  const tm = useTranslations('membership');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  // Savings badge reads the configured discount off the paid plan rather than
  // a literal, so an admin changing the annual discount updates the badge too.
  const annualDiscountPercent =
    tiers.find((t) => t.priceMonthly > 0)?.yearlyDiscountPercent ?? 0;

  return (
    <div>
      {/* Billing toggle */}
      <div
        role="group"
        aria-label={tm('billingCycleLabel')}
        className="mx-auto mb-10 flex w-fit items-center rounded-full border border-border/70 bg-background p-1 text-sm font-medium shadow-sm"
      >
        {(['monthly', 'yearly'] as BillingPeriod[]).map((period) => (
          <button
            key={period}
            type="button"
            aria-pressed={billingPeriod === period}
            onClick={() => setBillingPeriod(period)}
            className={cn(
              'min-h-[44px] rounded-full px-5 py-2 transition-colors',
              billingPeriod === period
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {period === 'monthly' ? tm('billingMonthly') : tm('billingYearly')}
            {period === 'yearly' && annualDiscountPercent > 0 && (
              <span
                className={cn(
                  'ms-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  billingPeriod === 'yearly'
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-green-100 text-green-700',
                )}
              >
                {tm('yearlySaveBadge', { percent: annualDiscountPercent })}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
        {tiers.map((tier) => {
          const isFree = tier.priceMonthly === 0;
          const perMonth =
            billingPeriod === 'yearly' ? Math.round(tier.priceYearly / 12) : tier.priceMonthly;

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

              <CardContent className="flex flex-1 flex-col p-6 sm:p-8">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-xl font-bold uppercase tracking-wide text-foreground">
                      {tier.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
                  </div>
                  {tier.highlighted && (
                    <Badge variant="primary" className="shrink-0 text-xs">
                      {mostPopularLabel}
                    </Badge>
                  )}
                </div>

                {/* Price */}
                <div className="mt-8 min-h-[72px]">
                  {isFree ? (
                    <span className="font-display text-4xl font-bold text-foreground">
                      {tm('priceFree')}
                    </span>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span className="font-display text-4xl font-bold text-foreground">
                          {formatCurrency(perMonth, locale)}
                        </span>
                        <span className="text-sm text-muted-foreground">{tm('perMonth')}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {billingPeriod === 'yearly'
                          ? tm('billedYearly', { total: formatCurrency(tier.priceYearly, locale) })
                          : tm('billedMonthlyAutoRenew')}
                      </p>
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
                  <Link href={ctaHref}>
                    {isFree ? tm('choosePlan') : tm('upgrade')}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>

                <PlanFeatureList features={tier.features} soonLabel={tm('soon')} className="mt-8" />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** Feature bullets; announced-but-not-live items are muted and tagged. */
export function PlanFeatureList({
  features,
  soonLabel,
  className,
}: {
  features: { label: string; soon?: boolean }[];
  soonLabel: string;
  className?: string;
}) {
  return (
    <ul className={cn('space-y-3', className)}>
      {features.map(({ label, soon }) => (
        <li key={label} className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
              soon ? 'bg-muted text-muted-foreground' : 'bg-primary-100 text-primary-700',
            )}
          >
            {soon ? <Clock className="size-2.5" strokeWidth={3} /> : <Check className="size-2.5" strokeWidth={3} />}
          </div>
          <span className={cn('min-w-0 text-sm', soon ? 'text-muted-foreground/80' : 'text-muted-foreground')}>
            {label}
            {soon && (
              <span className="ms-2 inline-block rounded bg-muted px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {soonLabel}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
