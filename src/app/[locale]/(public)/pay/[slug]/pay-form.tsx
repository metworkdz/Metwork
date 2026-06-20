'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Collects the (account-less) payer's name + email, then kicks off the hosted
 * checkout for an incubator payment link. Posts { action: 'init', … } to the
 * public route and sends the browser to the provider URL it returns. No card
 * fields ever live in our UI. Mirrors the booking pay button.
 */
export function PayLinkForm({ slug, locale }: { slug: string; locale: string }) {
  const t = useTranslations('pages.pay');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = name.trim().length >= 2 && emailValid && !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          payerName: name.trim(),
          payerEmail: email.trim(),
          locale,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string;
        state?: string;
      };

      if (res.ok && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      // Already settled while we were here — reload to show the paid state.
      if (res.ok && data.state === 'PAID') {
        window.location.reload();
        return;
      }
      if (res.status === 410) { setError(t('errorExpired')); setLoading(false); return; }
      if (res.status === 409) { window.location.reload(); return; }
      setError(t('payError'));
      setLoading(false);
    } catch {
      setError(t('payError'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="payer-name">{t('fullName')}</Label>
        <Input
          id="payer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('fullNamePlaceholder')}
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payer-email">{t('email')}</Label>
        <Input
          id="payer-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          required
          maxLength={160}
        />
        <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
      </div>

      <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!canSubmit}>
        <CreditCard className="size-4" />
        {loading ? t('starting') : t('payNow')}
      </Button>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
