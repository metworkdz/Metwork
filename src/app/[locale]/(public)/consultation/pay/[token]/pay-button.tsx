'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Kicks off the hosted-checkout for a guest consultation. Calls the public
 * settlement route with { action: 'init' } and sends the browser to the
 * provider URL it returns. No card fields ever live in our UI.
 */
export function GuestPayButton({ token }: { token: string }) {
  const t = useTranslations('pages.consultationPay');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPay() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/consultation/pay/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init' }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string;
        state?: string;
      };

      if (res.ok && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      // Already settled while we were here — just reload to show confirmed.
      if (res.ok && data.state === 'CONFIRMED') {
        window.location.reload();
        return;
      }
      if (res.status === 410) { setError(t('errorExpired')); setLoading(false); return; }
      setError(t('payError'));
      setLoading(false);
    } catch {
      setError(t('payError'));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button className="w-full" size="lg" onClick={onPay} loading={loading}>
        <CreditCard className="size-4" />
        {loading ? t('starting') : t('payNow')}
      </Button>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
