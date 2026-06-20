'use client';

/**
 * Cancel an UNPAID (awaiting-payment) booking from the incubator dashboard.
 * Two-step (click → confirm) so a stray click can't void a booking. On success
 * the server has already notified the client; we refresh the RSC list.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { XCircle } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export function CancelUnpaidButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations('pages.dashboard.incubator.bookings');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const res = await fetch(`/api/incubator/bookings/${bookingId}/cancel-unpaid`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        router.refresh();
        return;
      }
    } catch {
      /* surfaced by leaving the row unchanged */
    }
    setBusy(false);
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <XCircle className="size-3.5" /> {t('cancelUnpaid')}
      </Button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="destructive" className="h-8 text-xs" disabled={busy} onClick={() => void cancel()}>
        {busy ? t('cancelling') : t('confirmCancel')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-xs"
        disabled={busy}
        onClick={() => setConfirming(false)}
      >
        {t('keep')}
      </Button>
    </div>
  );
}
