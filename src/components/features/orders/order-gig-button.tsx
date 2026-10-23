'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouter } from '@/i18n/routing';
import { formatCurrency } from '@/lib/format';
import { SHEET_CONTENT_CLASS } from '@/components/features/wallet/payout-account';
import type { Locale } from '@/i18n/config';

const KNOWN = ['BLOCKED', 'CONTACT_LIMIT', 'TOO_SMALL', 'NOT_ALLOWED', 'RATE_LIMITED', 'MESSAGING_UNAVAILABLE'];

/** "Order this gig": confirms the price and the 50/50 payment, then creates the order. */
export function OrderGigButton({ gigId, title, price }: { gigId: string; title: string; price: number }) {
  const t = useTranslations('orders');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deposit = Math.ceil(price / 2);

  async function order() {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'GIG', gigId, lang: locale }),
    });
    setBusy(false);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';
      setErr(t(`errors.${KNOWN.includes(code) ? code : 'GENERIC'}`));
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/dashboard/entrepreneur/orders/${id}`);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}><ShoppingBag className="size-4" />{t('orderGig')}</Button>
      {open && (
        <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
          <DialogContent className={SHEET_CONTENT_CLASS}>
            <DialogHeader><DialogTitle>{t('orderGig')}</DialogTitle></DialogHeader>
            <div className="space-y-4 text-sm">
              <p className="font-medium" dir="auto">{title}</p>
              <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                <div><dt className="text-xs text-muted-foreground">{t('deposit')}</dt><dd className="font-semibold tabular-nums">{formatCurrency(deposit, locale)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('balance')}</dt><dd className="font-semibold tabular-nums">{formatCurrency(price - deposit, locale)}</dd></div>
              </dl>
              <p className="text-muted-foreground">{t('howItWorks')}</p>
              {err && <p role="alert" className="text-destructive">{err}</p>}
              <Button type="button" className="w-full" loading={busy} onClick={() => void order()}>{t('confirmOrder', { amount: formatCurrency(price, locale) })}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
