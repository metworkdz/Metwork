'use client';

/**
 * "Cash collected" — closes the cash leg of a booking that has a balance.
 *
 * Two shapes reach this button: a card deposit paid online with the rest due
 * on the day, and a walk-in recorded at the desk. Both are settled the same
 * way — hand to hand, off-platform — so this records the fact and moves no
 * money. The server re-checks everything; this only asks.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export function MarkCashPaidButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations('incubator.bookings');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function collect() {
    setBusy(true);
    try {
      const res = await fetch(`/api/incubator/bookings/${bookingId}/mark-cash-paid`, {
        method: 'PATCH',
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 gap-1.5"
      disabled={busy}
      title={t('markCashPaid')}
      onClick={collect}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Banknote className="size-3.5" />}
      {t('markCashPaid')}
    </Button>
  );
}
