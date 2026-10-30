'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';

interface Props {
  plan: 'MONTHLY' | 'ANNUAL';
  until: string;
  autoRenew: boolean;
  renewalAmount: string;
}

/** The member's Pass in "My learning": until when, and cancel / resume monthly renewal. */
export function PassCard({ plan, until, autoRenew, renewalAmount }: Props) {
  const t = useTranslations('academy.passCard');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setRenew(value: boolean) {
    setBusy(true);
    try { await apiClient.post('/academy/pass/auto-renew', { autoRenew: value }); setConfirming(false); router.refresh(); }
    finally { setBusy(false); }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl p-5 text-white sm:flex-row sm:items-center" style={{ background: 'linear-gradient(120deg,#057A41 0%,#049B4C 60%,#04A54F 100%)' }}>
      <GraduationCap className="size-9 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/80">{plan === 'ANNUAL' ? t('annual') : t('monthly')}</p>
        <p className="mt-1 font-display text-xl font-extrabold">
          {plan === 'MONTHLY' && autoRenew ? t('renewsOn', { date: until }) : t('endsOn', { date: until })}
        </p>
        <p className="text-sm text-white/85">{plan === 'MONTHLY' && autoRenew ? t('renewalAmount', { amount: renewalAmount }) : t('noRenewal')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild className="bg-white font-bold text-[#04150C] hover:bg-white/90"><Link href={{ pathname: '/academy/courses', query: { pass: '1' } }}>{t('browse')}</Link></Button>
        {plan === 'MONTHLY' && autoRenew && !confirming && (
          <Button variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => setConfirming(true)}>{t('cancel')}</Button>
        )}
        {plan === 'MONTHLY' && autoRenew && confirming && (
          <div className="flex items-center gap-2 text-sm">
            <span>{t('cancelConfirm', { date: until })}</span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRenew(false)}>{busy && <Loader2 className="me-1 size-3.5 animate-spin" />}{t('cancelYes')}</Button>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/15 hover:text-white" onClick={() => setConfirming(false)}>{t('keep')}</Button>
          </div>
        )}
        {plan === 'MONTHLY' && !autoRenew && (
          <Button variant="secondary" disabled={busy} onClick={() => setRenew(true)}>{busy && <Loader2 className="me-1 size-3.5 animate-spin" />}{t('resume')}</Button>
        )}
      </div>
    </section>
  );
}
