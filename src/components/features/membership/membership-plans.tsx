'use client';

import { useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

export interface MembershipPlanCard {
  code: 'FREE' | 'ENTREPRENEUR' | 'STARTUP';
  name: string;
  description: string;
  /** Per-month display figure (never charged directly for paid tiers). */
  priceMonthly: number;
  /** Full amount charged for a 6-month period (monthly × 6, no discount). */
  priceSemesterly: number;
  /** Full amount charged for a 12-month period (monthly × 12 × 0.7). */
  priceYearly: number;
  yearlyDiscountPercent: number;
  /** Months in a semesterly cycle — drives the "billed every N months" copy. */
  semesterlyMonths: number;
  highlighted: boolean;
  features: string[];
}

interface Props {
  tiers: MembershipPlanCard[];
  locale: Locale;
  mostPopularLabel: string;
}

type BillingPeriod = 'semesterly' | 'yearly';

export function MembershipPlans({ tiers, locale, mostPopularLabel }: Props) {
  const tm = useTranslations('membership');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('semesterly');
  // Savings badge reads the configured discount off the paid plans rather than
  // a literal, so an admin changing the annual discount updates the badge too.
  const annualDiscountPercent =
    tiers.find((t) => t.priceMonthly > 0)?.yearlyDiscountPercent ?? 0;

  return (
    <div>
      {/* Billing toggle */}
      <div className="mx-auto mb-10 flex w-fit items-center rounded-full border border-border/70 bg-background p-1 text-sm font-medium shadow-sm">
        {(['semesterly', 'yearly'] as BillingPeriod[]).map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => setBillingPeriod(period)}
            className={cn(
              'rounded-full px-5 py-2 transition-colors',
              billingPeriod === period
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {period === 'semesterly' ? tm('billingSemesterly') : tm('billingYearly')}
            {period === 'yearly' && (
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

      <div className="grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => {
          const isFree = tier.code === 'FREE';
          const perMonth =
            billingPeriod === 'yearly' ? Math.round(tier.priceYearly / 12) : tier.priceMonthly;
          const billedTotal = billingPeriod === 'yearly' ? tier.priceYearly : tier.priceSemesterly;

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
                <div className="mt-8 min-h-[88px]">
                  {isFree ? (
                    <span className="font-display text-4xl font-bold text-foreground">
                      {tm('priceFree')}
                    </span>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-display text-4xl font-bold text-foreground">
                          {formatCurrency(perMonth, locale)}
                        </span>
                        <span className="text-sm text-muted-foreground">{tm('perMonth')}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {billingPeriod === 'yearly'
                          ? tm('billedYearly', { total: formatCurrency(billedTotal, locale) })
                          : tm('billedSemesterly', { total: formatCurrency(billedTotal, locale) })}
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
    </div>
  );
}
