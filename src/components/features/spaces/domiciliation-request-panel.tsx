'use client';

/**
 * DOMICILIATION request panel for the public space detail page.
 *
 * Shows an address-slot availability counter and a contact form. No payment, no
 * wallet, no calendar — submitting POSTs to /api/spaces/domiciliation-request,
 * which records a PENDING request the incubator follows up offline. Works for
 * both guests and signed-in users (the server attaches userId when present).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, MailCheck, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/components/providers/auth-provider';

interface Props {
  spaceId: string;
  availability: { total: number; used: number; available: number };
}

const MESSAGE_MAX = 300;

export function DomiciliationRequestPanel({ spaceId, availability }: Props) {
  const t = useTranslations('spaces.detail');
  const { user } = useAuth();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) { setError(t('domErrorName')); return; }
    if (!phone.trim()) { setError(t('domErrorPhone')); return; }
    if (!email.trim()) { setError(t('domErrorEmail')); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/spaces/domiciliation-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          spaceId,
          fullName: fullName.trim(),
          companyName: companyName.trim() || null,
          phone: phone.trim(),
          email: email.trim(),
          message: message.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? t('domErrorGeneric'));
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('domErrorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <MailCheck className="mx-auto size-7 text-emerald-600" />
        <p className="mt-2 text-base font-semibold text-emerald-900 dark:text-emerald-100">
          {t('domSuccessTitle')}
        </p>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
          {t('domSuccessBody')}
        </p>
      </div>
    );
  }

  const hasSlots = availability.available > 0;

  return (
    <div className="space-y-4">
      {/* Availability counter */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-primary" />
          {hasSlots ? (
            <p className="text-sm font-medium text-foreground">
              {t('domAddressesAvailable', { count: availability.available })}
            </p>
          ) : (
            <p className="text-sm font-medium text-foreground">{t('domNoAddresses')}</p>
          )}
        </div>
        {!hasSlots && (
          <p className="mt-1 text-xs text-muted-foreground">{t('domNoAddressesHint')}</p>
        )}
      </div>

      {/* Request form */}
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="dom-name">{t('domFullName')} *</Label>
          <Input id="dom-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dom-company">{t('domCompany')}</Label>
          <Input id="dom-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} placeholder={t('optional')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dom-phone">{t('domPhone')} *</Label>
            <Input id="dom-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} placeholder="+213…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dom-email">{t('domEmail')} *</Label>
            <Input id="dom-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="you@email.com" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dom-message">{t('domMessage')}</Label>
          <textarea
            id="dom-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
            maxLength={MESSAGE_MAX}
            rows={3}
            placeholder={t('optional')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <p className="text-end text-[11px] text-muted-foreground">{message.length}/{MESSAGE_MAX}</p>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full gap-1.5" loading={submitting}>
          <CheckCircle2 className="size-4" />
          {t('domSendRequest')}
        </Button>
      </form>
    </div>
  );
}
