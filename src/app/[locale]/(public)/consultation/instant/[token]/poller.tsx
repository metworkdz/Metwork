'use client';

/**
 * Polls the settle endpoint while a consultation payment is still in flight.
 *
 * Purely a UX affordance. The authoritative confirmation is the provider
 * webhook (and the reconcile cron as a backstop) — this just saves the payer
 * from staring at a stale page when they land back before the callback does.
 * The endpoint is idempotent, so polling it cannot settle anything twice.
 *
 * Gives up after a bounded number of attempts rather than hammering forever;
 * the manual retry button stays available and the booking settles regardless.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** ~2 minutes of background checking. */
const MAX_ATTEMPTS = 12;
const INTERVAL_MS = 10_000;

export function InstantPaymentPoller({ token }: { token: string }) {
  const t = useTranslations('pages.consultationReturn');
  const [checking, setChecking] = useState(false);
  const attempts = useRef(0);

  const check = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/consultation/instant/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'verify' }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { state?: string };
      if (data.state === 'CONFIRMED') {
        // Re-render the server component with the settled state.
        window.location.reload();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      attempts.current += 1;
      if (attempts.current > MAX_ATTEMPTS) {
        clearInterval(id);
        return;
      }
      void check();
    }, INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [check]);

  return (
    <div className="mt-6 space-y-3">
      <Button
        variant="outline"
        className="w-full"
        loading={checking}
        onClick={async () => {
          setChecking(true);
          const done = await check();
          if (!done) setChecking(false);
        }}
      >
        {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {t('checkAgain')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('autoCheckNote')}</p>
    </div>
  );
}
