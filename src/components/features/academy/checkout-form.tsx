'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Loader2, Wallet } from 'lucide-react';
import { useRouter, Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface Props {
  /** What is bought: a course (by slug), a Pass term or a bundle. */
  target: { courseSlug: string } | { pass: 'MONTHLY' | 'ANNUAL' } | { bundleSlug: string };
  /** Buying it for someone else (a course or one Pass month). */
  asGift?: boolean;
  amountDzd: number;
  walletBalance: number;
  locale: 'fr' | 'en' | 'ar';
  amountLabel: string;
}

/** Pick wallet or card, then pay. The amount shown is the server's quote; the server recomputes it anyway. */
export function CheckoutForm({ target, asGift, amountDzd, walletBalance, locale, amountLabel }: Props) {
  const t = useTranslations('academy.checkout');
  const router = useRouter();
  const enoughInWallet = walletBalance >= amountDzd;
  const [method, setMethod] = useState<'WALLET' | 'CARD'>(enoughInWallet ? 'WALLET' : 'CARD');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gift, setGift] = useState({ name: '', contact: '', message: '' });
  const giftReady = !asGift || (gift.name.trim().length > 0 && gift.contact.trim().length >= 5);
  // One key per page view: a double click or a retry never pays twice.
  const targetKey = 'pass' in target ? `pass-${target.pass}` : 'bundleSlug' in target ? `bundle-${target.bundleSlug}` : target.courseSlug;
  const clientReference = useMemo(() => `academy-${targetKey}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, [targetKey]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ state: 'PAID'; courseSlug?: string; orderId: string } | { state: 'REDIRECT'; redirectUrl: string }>(
        '/academy/checkout',
        { ...target, method, clientReference, locale, ...(asGift ? { gift: { name: gift.name.trim(), contact: gift.contact.trim(), message: gift.message.trim() || null } } : {}) },
      );
      if (res.state === 'PAID') {
        // A gift or a bundle lands on the order's page; a course opens; a Pass shows the catalogue.
        if (asGift || 'bundleSlug' in target) router.push(`/academy/checkout/return/${res.orderId}`);
        else router.push(res.courseSlug ? `/academy/learn/${res.courseSlug}` : '/academy/courses?pass=1');
      }
      else window.location.assign(res.redirectUrl);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      const known = ['INSUFFICIENT_FUNDS', 'ALREADY_OWNED', 'ALREADY_SUBSCRIBED', 'NOT_A_BUYER', 'WALLET_FROZEN', 'PROVIDER_FAILED', 'RATE_LIMITED', 'BAD_CONTACT', 'BUNDLE_NOT_FOUND'];
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
      {asGift && (
        <fieldset className="space-y-3 rounded-2xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{t('gift.legend')}</legend>
          <div className="space-y-1.5">
            <Label htmlFor="gift-name">{t('gift.name')}</Label>
            <Input id="gift-name" value={gift.name} maxLength={80} onChange={(e) => setGift({ ...gift, name: e.target.value })} className="text-base sm:text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gift-contact">{t('gift.contact')}</Label>
            <Input id="gift-contact" dir="ltr" value={gift.contact} maxLength={120} placeholder={t('gift.contactPlaceholder')} onChange={(e) => setGift({ ...gift, contact: e.target.value })} className="text-base sm:text-sm" />
            <p className="text-xs text-muted-foreground">{t('gift.contactHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gift-message">{t('gift.message')}</Label>
            <Textarea id="gift-message" rows={2} maxLength={500} value={gift.message} onChange={(e) => setGift({ ...gift, message: e.target.value })} className="text-base sm:text-sm" />
          </div>
        </fieldset>
      )}
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
        {asGift ? t('gift.terms') : 'pass' in target ? t('passTerms') : 'bundleSlug' in target ? t('bundleTerms') : t('terms')}
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="lg" className="w-full font-bold" disabled={busy || !accepted || !giftReady} onClick={pay}>
        {busy && <Loader2 className="me-2 size-4 animate-spin" />}
        {method === 'WALLET' ? t('payWallet', { amount: amountLabel }) : t('payCard', { amount: amountLabel })}
      </Button>
    </div>
  );
}
