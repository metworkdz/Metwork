'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/config';

interface Props {
  plan: 'ENTREPRENEUR' | 'STARTUP';
  /** Per-month display figure (never charged directly). */
  priceMonthly: number;
  /** Full amount charged for a 6-month period (monthly × 6, no discount). */
  priceSemesterly: number;
  /** Full amount charged for a 12-month period (monthly × 12 × 0.7). */
  priceYearly: number;
  planName: string;
  highlighted?: boolean;
  locale: Locale;
}

type BillingPeriod = 'semesterly' | 'yearly';
type DialogStep = 'idle' | 'confirm' | 'success' | 'error';

export function MembershipUpgradeButton({
  plan,
  priceMonthly,
  priceSemesterly,
  priceYearly,
  planName,
  highlighted,
  locale,
}: Props) {
  const t = useTranslations('entrepreneur.membershipUpgrade');
  const router = useRouter();
  const [step, setStep] = useState<DialogStep>('idle');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('semesterly');
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<{
    checking: boolean;
    valid: boolean | null;
    discount: number;
    message: string;
  }>({ checking: false, valid: null, discount: 0, message: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const basePrice = billingPeriod === 'yearly' ? priceYearly : priceSemesterly;
  const perMonth = billingPeriod === 'yearly' ? Math.round(priceYearly / 12) : priceMonthly;
  const discountAmount = Math.floor((basePrice * promoStatus.discount) / 100);
  const finalPrice = Math.max(0, basePrice - discountAmount);

  async function checkPromoCode() {
    const code = promoCode.trim();
    if (!code) return;
    setPromoStatus({ checking: true, valid: null, discount: 0, message: '' });
    try {
      const res = await fetch('/api/promo-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.valid && (data.appliesTo === 'ALL' || data.appliesTo === 'MEMBERSHIP')) {
        setPromoStatus({
          checking: false,
          valid: true,
          discount: data.discountPercent,
          message: data.message,
        });
      } else {
        setPromoStatus({
          checking: false,
          valid: false,
          discount: 0,
          message: data.message ?? (data.valid ? t('promoNotApplicable') : t('promoInvalid')),
        });
      }
    } catch {
      setPromoStatus({ checking: false, valid: false, discount: 0, message: t('promoValidateError') });
    }
  }

  function clearPromo() {
    setPromoCode('');
    setPromoStatus({ checking: false, valid: null, discount: 0, message: '' });
  }

  function handlePurchase() {
    setErrorMsg('');
    startTransition(async () => {
      try {
        const res = await fetch('/api/memberships/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan,
            billingPeriod,
            promoCode: promoCode.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 422 && data.code === 'INSUFFICIENT_FUNDS') {
            setErrorMsg(t('errorInsufficientFunds', { amount: formatCurrency(data.details?.required ?? finalPrice, locale) }));
          } else {
            setErrorMsg(data.message ?? t('errorPurchaseFailed'));
          }
          setStep('error');
          return;
        }
        setStep('success');
        // Reload the page after a short delay to show updated plan
        setTimeout(() => {
          router.refresh();
          setStep('idle');
        }, 2500);
      } catch {
        setErrorMsg(t('errorNetwork'));
        setStep('error');
      }
    });
  }

  if (step === 'idle') {
    return (
      <Button
        variant={highlighted ? 'default' : 'outline'}
        className="w-full"
        onClick={() => setStep('confirm')}
      >
        {t('upgradeTo', { planName })}
      </Button>
    );
  }

  if (step === 'success') {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-md bg-green-50 p-3 text-sm font-medium text-green-700">
        <CheckCircle2 className="size-4" />
        {t('upgradedTo', { planName })}
      </div>
    );
  }

  // Confirm / Error dialog (inline — no modal portal needed)
  return (
    <div className="w-full space-y-3 rounded-lg border border-border bg-background p-4 shadow-sm">
      <p className="text-sm font-semibold">{t('upgradeTo', { planName })}</p>

      {/* Billing period toggle */}
      <div className="flex overflow-hidden rounded-md border border-input text-xs font-medium">
        {(['semesterly', 'yearly'] as BillingPeriod[]).map((period) => (
          <button
            key={period}
            type="button"
            onClick={() => setBillingPeriod(period)}
            className={cn(
              'flex-1 py-1.5 text-center transition-colors',
              billingPeriod === period
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            {period === 'semesterly' ? t('billingSemesterly') : t('billingYearly')}
          </button>
        ))}
      </div>

      {/* Per-month price + billing cadence */}
      <div className="flex items-baseline justify-center gap-1.5 text-center">
        <span className="text-2xl font-semibold tracking-tight">
          {formatCurrency(perMonth, locale)}
        </span>
        <span className="text-xs text-muted-foreground">{t('perMonth')}</span>
        {billingPeriod === 'yearly' && (
          <span className="ms-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
            {t('yearlySave', { percent: 30 })}
          </span>
        )}
      </div>
      <p className="-mt-1 text-center text-[11px] text-muted-foreground">
        {billingPeriod === 'yearly'
          ? t('billedYearly', { total: formatCurrency(priceYearly, locale) })
          : t('billedSemesterly', { total: formatCurrency(priceSemesterly, locale) })}
      </p>

      {/* Promo code */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('promoPlaceholder')}
            value={promoCode}
            onChange={(e) => {
              setPromoCode(e.target.value.toUpperCase());
              if (promoStatus.valid !== null) clearPromo();
            }}
            className="ps-8 text-xs uppercase"
            disabled={promoStatus.valid === true}
          />
        </div>
        {promoStatus.valid === true ? (
          <Button type="button" variant="outline" size="sm" onClick={clearPromo} className="shrink-0 text-xs">
            {t('promoRemove')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkPromoCode}
            disabled={!promoCode.trim() || promoStatus.checking}
            className="shrink-0 text-xs"
          >
            {promoStatus.checking ? '…' : t('promoApply')}
          </Button>
        )}
      </div>

      {promoStatus.message && (
        <p className={cn('text-xs', promoStatus.valid ? 'text-green-600' : 'text-destructive')}>
          {promoStatus.message}
        </p>
      )}

      {/* Price summary */}
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('subtotal')}</span>
          <span>{formatCurrency(basePrice, locale)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>{t('discount', { percent: promoStatus.discount })}</span>
            <span>−{formatCurrency(discountAmount, locale)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
          <span>{t('total')}</span>
          <span>{finalPrice === 0 ? t('free') : formatCurrency(finalPrice, locale)}</span>
        </div>
      </div>

      {step === 'error' && errorMsg && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {errorMsg}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={() => { setStep('idle'); clearPromo(); }}
          disabled={isPending}
        >
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={handlePurchase}
          loading={isPending}
        >
          {isPending ? t('processing') : t('pay', { amount: finalPrice === 0 ? t('nothing') : formatCurrency(finalPrice, locale) })}
        </Button>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        {t('chargedToWallet')}
      </p>
    </div>
  );
}
