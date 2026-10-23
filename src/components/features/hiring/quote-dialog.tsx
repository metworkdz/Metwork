'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link, useRouter } from '@/i18n/routing';
import { SHEET_CONTENT_CLASS } from '@/components/features/wallet/payout-account';

interface Props {
  freelancerId: string;
  freelancerName: string;
  gig?: { id: string; title: string } | null;
  /** Quote requests left this month, null = unlimited. */
  remaining: number | null;
  variant?: 'default' | 'outline';
  size?: 'sm' | 'default';
}

const KNOWN = ['QUOTE_LIMIT', 'CONTACT_LIMIT', 'BLOCKED', 'NOT_ALLOWED', 'RATE_LIMITED', 'MESSAGING_UNAVAILABLE'];

/** "Request a quote": a short brief that opens the conversation with the freelancer. */
export function QuoteDialog({ freelancerId, freelancerName, gig = null, remaining, variant = 'default', size = 'default' }: Props) {
  const t = useTranslations('hiring');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(gig?.title ?? '');
  const [details, setDetails] = useState('');
  const [budget, setBudget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const out = remaining === 0;

  async function send() {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/hiring/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        freelancerId,
        gigId: gig?.id ?? null,
        title: title.trim(),
        details: details.trim(),
        budget: Number(budget) > 0 ? Number(budget) : null,
        deadline: deadline || null,
        lang: locale,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';
      setErr(t(`errors.${KNOWN.includes(code) ? code : 'GENERIC'}`));
      return;
    }
    const { conversationId } = (await res.json()) as { conversationId: string };
    router.push(`/dashboard/entrepreneur/messages?c=${conversationId}`);
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}><FileText className="size-4" />{t('requestQuote')}</Button>
      {open && (
        <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
          <DialogContent className={SHEET_CONTENT_CLASS}>
            <DialogHeader><DialogTitle>{t('quoteTitle', { name: freelancerName })}</DialogTitle></DialogHeader>
            {out ? (
              <div className="space-y-3 text-sm">
                <p>{t('errors.QUOTE_LIMIT')}</p>
                <Button asChild className="w-full"><Link href="/dashboard/entrepreneur/membership">{t('upgrade')}</Link></Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="q-title" className="text-sm font-medium">{t('quoteSubject')}</label>
                  <Input id="q-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5 text-base sm:text-sm" />
                </div>
                <div>
                  <label htmlFor="q-details" className="text-sm font-medium">{t('quoteDetails')}</label>
                  <Textarea id="q-details" rows={5} maxLength={3000} value={details} placeholder={t('quoteDetailsPlaceholder')} onChange={(e) => setDetails(e.target.value)} className="mt-1.5 text-base sm:text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="q-budget" className="text-sm font-medium">{t('budget')}</label>
                    <Input id="q-budget" inputMode="numeric" dir="ltr" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, '').slice(0, 9))} className="mt-1.5 text-base tabular-nums sm:text-sm" />
                  </div>
                  <div>
                    <label htmlFor="q-deadline" className="text-sm font-medium">{t('deadline')}</label>
                    <Input id="q-deadline" type="date" value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDeadline(e.target.value)} className="mt-1.5 text-base sm:text-sm" />
                  </div>
                </div>
                {remaining !== null && <p className="text-xs text-muted-foreground">{t('quotesLeft', { count: remaining })}</p>}
                {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
                <Button type="button" className="w-full" loading={busy} disabled={title.trim().length < 3 || details.trim().length < 10} onClick={() => void send()}>{t('sendQuote')}</Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
