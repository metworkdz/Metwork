'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Loader2, Wallet } from 'lucide-react';
import { useRouter, Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface Props {
  /** What is bought: a course (by slug) or a Pass term. */
  target: { courseSlug: string } | { pass: 'MONTHLY' | 'ANNUAL' };
  amountDzd: number;
  walletBalance: number;
  locale: 'fr' | 'en' | 'ar';
  amountLabel: string;
}

/** Pick wallet or card, then pay. The amount shown is the server's quote; the server recomputes it anyway. */
export function CheckoutForm({ target, amountDzd, walletBalance, locale, amountLabel }: Props) {
  const t = useTranslations('academy.checkout');
  const router = useRouter();
  const enoughInWallet = walletBalance >= amountDzd;
  const [method, setMethod] = useState<'WALLET' | 'CARD'>(enoughInWallet ? 'WALLET' : 'CARD');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per page view: a double click or a retry never pays twice.
  const targetKey = 'pass' in target ? `pass-${target.pass}` : target.courseSlug;
  const clientReference = useMemo(() => `academy-${targetKey}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, [targetKey]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ state: 'PAID'; courseSlug?: string } | { state: 'REDIRECT'; redirectUrl: string }>(
        '/academy/checkout', { ...target, method, clientReference, locale },
      );
      if (res.state === 'PAID') router.push(res.courseSlug ? `/academy/learn/${res.courseSlug}` : '/academy/courses?pass=1');
      else window.location.assign(res.redirectUrl);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      const known = ['INSUFFICIENT_FUNDS', 'ALREADY_OWNED', 'ALREADY_SUBSCRIBED', 'NOT_A_BUYER', 'WALLET_FROZEN', 'PROVIDER_FAILED', 'RATE_LIMITED'];
      setError(known.includes(code) ? t(`errors.${code}`) : t('errors.generic'));
      setBusy(false);
    }
  }

  const option = (value: 'WALLET' | 'CARD', icon: React.ReactNode, title: string, desc: string, disabled = false) => (
    <label className={cn(
      'flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition-colors',
      method === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/50',
      disabled && 'cursor-not-allowed opacity-60',
    )}>
      <input type="radio" name="method" value={value} checked={method === value} disabled={disabled} onChange={() => setMethod(value)} className="size-4 accent-[hsl(var(--primary))]" />
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{desc}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">{t('method')}</legend>
        {option('WALLET', <Wallet className="size-5" />, t('wallet'), enoughInWallet ? t('walletDesc', { balance: walletBalance.toLocaleString(locale === 'ar' ? 'ar-DZ' : 'fr-DZ') }) : t('walletShort', { balance: walletBalance.toLocaleString(locale === 'ar' ? 'ar-DZ' : 'fr-DZ') }), !enoughInWallet)}
        {option('CARD', <CreditCard className="size-5" />, t('card'), t('cardDesc'))}
        {!enoughInWallet && (
          <p className="text-sm text-muted-foreground">
            {t('topUpHint')} <Link href="/dashboard" className="font-semibold text-primary hover:underline">{t('topUp')}</Link>
          </p>
        )}
      </fieldset>
      <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]" />
        {'pass' in target ? t('passTerms') : t('terms')}
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="lg" className="w-full font-bold" disabled={busy || !accepted} onClick={pay}>
        {busy && <Loader2 className="me-2 size-4 animate-spin" />}
        {method === 'WALLET' ? t('payWallet', { amount: amountLabel }) : t('payCard', { amount: amountLabel })}
      </Button>
    </div>
  );
}
