'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import type { PassPlan, PassQuote } from '@/lib/academy';
import { cn } from '@/lib/utils';
import { formatDzd } from './format';

interface Me {
  signedIn: boolean;
  canBuy: boolean;
  premium: boolean;
  quotes: Record<PassPlan, PassQuote>;
  active: { plan: PassPlan; periodEnd: string; autoRenew: boolean } | null;
}

/**
 * The two Pass plans. Server-rendered list prices first (SEO, no flash), then
 * the visitor's own prices and state: Premium price, or "you're subscribed".
 */
export function PassPlans({ initial, premiumPercent }: { initial: Record<PassPlan, PassQuote>; premiumPercent: number }) {
  const t = useTranslations('academy.passPage');
  const tm = useTranslations('academy');
  const locale = useLocale();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { apiClient.get<Me>('/academy/pass/me').then(setMe).catch(() => setMe(null)); }, []);

  const quotes = me?.quotes ?? initial;
  const money = (n: number) => tm('money', { price: formatDzd(n, locale) });
  const until = me?.active ? new Date(me.active.periodEnd).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const plan = (p: PassPlan, featured: boolean) => {
    const q = quotes[p];
    const perMonth = p === 'ANNUAL' ? Math.round(q.amountDzd / 12) : null;
    const renewing = me?.active?.autoRenew;
    return (
      <div className={cn('flex flex-col rounded-3xl border p-6', featured ? 'border-primary shadow-xl shadow-primary/10 ring-1 ring-primary' : 'border-border')}>
        {featured && <span className="mb-3 w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">{t('popular')}</span>}
        <h2 className="font-display text-lg font-extrabold">{p === 'ANNUAL' ? t('annualName') : t('monthlyName')}</h2>
        <p className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className="font-display text-4xl font-extrabold tabular-nums">{money(q.amountDzd)}</span>
          {q.discount === 'PREMIUM' && <s className="text-muted-foreground tabular-nums">{money(q.listPriceDzd)}</s>}
        </p>
        <p className="text-sm text-muted-foreground">{p === 'ANNUAL' ? t('perYear', { perMonth: money(perMonth ?? 0) }) : t('perMonth')}</p>
        {q.discount === 'PREMIUM' && <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-400">{t('yourPremiumPrice')}</p>}
        <ul className="my-6 space-y-2 text-sm">
          {(['all', 'new', 'certificates', p === 'ANNUAL' ? 'oneYear' : 'cancel'] as const).map((k) => (
            <li key={k} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{t(`features.${k}`)}</li>
          ))}
        </ul>
        <div className="mt-auto">
          {renewing ? (
            <Button asChild variant="outline" className="w-full"><Link href="/academy/my">{t('manage')}</Link></Button>
          ) : (
            <Button asChild size="lg" variant={featured ? 'default' : 'outline'} className="w-full font-bold" disabled={me ? !me.canBuy : false}>
              <Link href={{ pathname: '/academy/checkout', query: { pass: p } }}>{me?.active ? t('extend') : t('subscribe')}</Link>
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {me?.active && (
        <p className="rounded-2xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
          {me.active.autoRenew ? t('activeRenewing', { date: until }) : t('activeEnding', { date: until })}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {plan('MONTHLY', true)}
        {plan('ANNUAL', false)}
      </div>
      {me && !me.canBuy && <p className="text-sm text-muted-foreground">{tm('checkout.errors.NOT_A_BUYER')}</p>}
      {me?.canBuy && (
        <p className="text-sm">
          <Link href={{ pathname: '/academy/checkout', query: { pass: 'MONTHLY', gift: '1' } }} className="font-semibold text-primary hover:underline">{tm('gift.offerPass')}</Link>
        </p>
      )}
      {me && !me.premium && <p className="text-sm text-muted-foreground">{t('premiumNudge', { percent: premiumPercent })} <Link href="/pricing" className="font-semibold text-primary hover:underline">{t('premiumCta')}</Link></p>}
    </div>
  );
}
