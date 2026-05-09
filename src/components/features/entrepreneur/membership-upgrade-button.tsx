'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/config';

interface Props {
  plan: 'ENTREPRENEUR' | 'STARTUP';
  priceMonthly: number;
  priceYearly: number;
  planName: string;
  highlighted?: boolean;
  locale: Locale;
}

type BillingPeriod = 'monthly' | 'yearly';
type DialogStep = 'idle' | 'confirm' | 'success' | 'error';

export function MembershipUpgradeButton({
  plan,
  priceMonthly,
  priceYearly,
  planName,
  highlighted,
  locale,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<DialogStep>('idle');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<{
    checking: boolean;
    valid: boolean | null;
    discount: number;
    message: string;
  }>({ checking: false, valid: null, discount: 0, message: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const basePrice = billingPeriod === 'yearly' ? priceYearly : priceMonthly;
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
          message: data.message ?? (data.valid ? 'This code does not apply to memberships' : 'Invalid promo code'),
        });
      }
    } catch {
      setPromoStatus({ checking: false, valid: false, discount: 0, message: 'Could not validate code' });
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
            setErrorMsg(`Insufficient wallet balance. Required: ${formatCurrency(data.details?.required ?? finalPrice, locale)}.`);
          } else {
            setErrorMsg(data.message ?? 'Purchase failed. Please try again.');
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
        setErrorMsg('Network error. Please try again.');
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
        Upgrade to {planName}
      </Button>
    );
  }

  if (step === 'success') {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-md bg-green-50 p-3 text-sm font-medium text-green-700">
        <CheckCircle2 className="size-4" />
        Upgraded to {planName}!
      </div>
    );
  }

  // Confirm / Error dialog (inline — no modal portal needed)
  return (
    <div className="w-full space-y-3 rounded-lg border border-border bg-background p-4 shadow-sm">
      <p className="text-sm font-semibold">Upgrade to {planName}</p>

      {/* Billing period toggle */}
      <div className="flex overflow-hidden rounded-md border border-input text-xs font-medium">
        {(['monthly', 'yearly'] as BillingPeriod[]).map((period) => (
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
            {period === 'monthly'
              ? `Monthly — ${formatCurrency(priceMonthly, locale)}`
              : `Yearly — ${formatCurrency(priceYearly, locale)} (save 30%)`}
          </button>
        ))}
      </div>

      {/* Promo code */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Promo code"
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
            Remove
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
            {promoStatus.checking ? '…' : 'Apply'}
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
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatCurrency(basePrice, locale)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Discount ({promoStatus.discount}%)</span>
            <span>−{formatCurrency(discountAmount, locale)}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
          <span>Total</span>
          <span>{finalPrice === 0 ? 'Free' : formatCurrency(finalPrice, locale)}</span>
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
          Cancel
        </Button>
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={handlePurchase}
          loading={isPending}
        >
          {isPending ? 'Processing…' : `Pay ${finalPrice === 0 ? 'nothing' : formatCurrency(finalPrice, locale)}`}
        </Button>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        Charged to your Metwork wallet
      </p>
    </div>
  );
}
