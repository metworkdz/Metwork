'use client';

/**
 * "Pay now" action for an APPROVED_UNPAID request-to-book reservation.
 * Wallet-settled: POSTs the tokenized pay request; on a short balance shows
 * the existing top-up nudge (wallet page link) so the user can return here.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';

export function RequestPayButton({ bookingId, token }: { bookingId: string; token: string }) {
  const t = useTranslations('pages.bookingRequestPay');
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [needsTopUp, setNeedsTopUp] = useState<{ balance: number; required: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPay() {
    setSubmitting(true);
    setError(null);
    try {
      await bookingService.payRequestBooking(bookingId, token);
      setPaid(true);
      // Re-render the server page so the summary flips to "confirmed".
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'INSUFFICIENT_FUNDS') {
          const d = err.details as { balance?: number; required?: number } | undefined;
          setNeedsTopUp({ balance: d?.balance ?? 0, required: d?.required ?? 0 });
        } else if (err.code === 'LINK_EXPIRED') {
          setError(t('errorExpired'));
        } else {
          setError(err.message || t('errorGeneric'));
        }
      } else {
        setError(t('errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (paid) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-3 text-sm font-medium text-primary"
      >
        <CheckCircle2 className="size-4 shrink-0" />
        {t('paidJustNow')}
      </div>
    );
  }

  if (needsTopUp) {
    return (
      <div className="space-y-2">
        <Button asChild className="w-full" size="lg" variant="outline">
          <Link href="/dashboard/entrepreneur/wallet">{t('topUp')}</Link>
        </Button>
        <Badge variant="warning" className="w-full justify-center py-1">
          {t('topUpHint')}
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" size="lg" loading={submitting} onClick={() => void onPay()}>
        {submitting ? t('paying') : t('payNow')}
      </Button>
      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
