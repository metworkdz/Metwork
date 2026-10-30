'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function RefundAccountForm({ token, alreadySubmitted, defaultHolder }: { token: string; alreadySubmitted: boolean; defaultHolder: string }) {
  const t = useTranslations('refunds.guest');
  const [type, setType] = useState<'ccp' | 'bank'>('ccp');
  const [holder, setHolder] = useState(defaultHolder);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadySubmitted);

  const digits = number.replace(/\s+/g, '');
  const numberOk = /^\d{20}$/.test(digits);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!numberOk) return setError(t('errNumber'));
    if (holder.trim().length < 2) return setError(t('errHolder'));
    setBusy(true);
    try {
      const res = await fetch(`/api/refunds/account/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: type, accountNumber: digits, holderName: holder.trim() }),
      });
      if (res.status === 429) return setError(t('errRate'));
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        return setError(body?.error?.code === 'INVALID_HOLDER_NAME' ? t('errHolder') : t('errNumber'));
      }
      if (!res.ok) return setError(t('errGeneric'));
      setDone(true);
    } catch {
      setError(t('errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900" role="status">
        <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-5" />{t('doneTitle')}</div>
        <p>{t('doneBody')}</p>
        <button type="button" className="text-xs underline" onClick={() => setDone(false)}>{t('again')}</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border" role="radiogroup">
        {(['ccp', 'bank'] as const).map((k) => (
          <button
            key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
            className={cn('px-3 py-2.5 text-sm font-semibold', type === k ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}
          >
            {t(k)}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="refund-holder" className="text-sm font-medium">{t('holder')}</label>
        <Input id="refund-holder" value={holder} onChange={(e) => setHolder(e.target.value)} placeholder={t('holderPlaceholder')} autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="refund-number" className="text-sm font-medium">{t('number')}</label>
        <Input
          id="refund-number" value={number} onChange={(e) => setNumber(e.target.value)}
          inputMode="numeric" autoComplete="off" dir="ltr" className="font-mono" placeholder="00000000000000000000"
        />
        <p className="text-xs text-muted-foreground">{t('numberHint')}</p>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t('submitting') : t('submit')}</Button>
    </form>
  );
}
