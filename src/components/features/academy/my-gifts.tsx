'use client';

/** Gifts the member offered: who, what, where it stands; the link can be sent again while unclaimed. */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

export interface MyGiftRow {
  id: string;
  what: string;
  recipientName: string;
  recipientContact: string;
  status: 'PAID' | 'CLAIMED' | 'REFUNDED' | 'PENDING_PAYMENT' | 'FAILED';
  expiresAt: string | null;
}

export function MyGifts({ gifts }: { gifts: MyGiftRow[] }) {
  const t = useTranslations('academy.gift.mine');
  const locale = useLocale();
  const [sent, setSent] = useState<Record<string, 'ok' | 'error'>>({});
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-DZ', { day: 'numeric', month: 'long' });
  return (
    <ul className="space-y-3">
      {gifts.map((g) => (
        <li key={g.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <Gift className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{g.what}</p>
            <p className="text-muted-foreground"><span dir="auto">{g.recipientName}</span> · <span dir="ltr">{g.recipientContact}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">
              {g.status === 'CLAIMED' ? t('claimed') : g.status === 'REFUNDED' ? t('refunded') : g.expiresAt ? t('waiting', { date: day(g.expiresAt) }) : t('waitingNoDate')}
            </p>
            {g.status === 'PAID' && (
              <button type="button" className="mt-1 text-xs font-semibold text-primary hover:underline" onClick={async () => {
                try { await apiClient.post(`/academy/gifts/${g.id}/resend`); setSent((s) => ({ ...s, [g.id]: 'ok' })); }
                catch { setSent((s) => ({ ...s, [g.id]: 'error' })); }
              }}>{sent[g.id] === 'ok' ? t('resent') : sent[g.id] === 'error' ? t('resendError') : t('resend')}</button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
