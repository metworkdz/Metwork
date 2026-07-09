'use client';

/**
 * Approve / decline actions for an AWAITING_APPROVAL request-to-book booking
 * (incubator dashboard). Approve transitions it to APPROVED_UNPAID and emails
 * the client a payment link — no money moves. Decline is two-step with a
 * reason (client is notified; nothing was ever charged).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type DeclineReason = 'space_unavailable' | 'space_closed' | 'other';

export function RequestApprovalButtons({ bookingId }: { bookingId: string }) {
  const t = useTranslations('pages.dashboard.incubator.bookings');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason>('space_unavailable');

  async function patch(body: { status: 'CONFIRMED' | 'CANCELLED'; declineReason?: string }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/incubator/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
    } catch {
      /* surfaced by leaving the row unchanged */
    }
    setBusy(false);
    setDeclining(false);
  }

  if (declining) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Select value={reason} onValueChange={(v) => setReason(v as DeclineReason)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="space_unavailable">{t('reasonSpaceUnavailable')}</SelectItem>
            <SelectItem value="space_closed">{t('reasonSpaceClosed')}</SelectItem>
            <SelectItem value="other">{t('reasonOther')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="destructive"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() =>
            void patch({
              status: 'CANCELLED',
              declineReason: t(
                reason === 'space_unavailable'
                  ? 'reasonSpaceUnavailable'
                  : reason === 'space_closed'
                  ? 'reasonSpaceClosed'
                  : 'reasonOther',
              ),
            })
          }
        >
          {busy ? t('declining') : t('confirmDecline')}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => setDeclining(false)}>
          {t('keep')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        className="h-8 gap-1 text-xs"
        disabled={busy}
        onClick={() => void patch({ status: 'CONFIRMED' })}
      >
        <CheckCircle2 className="size-3.5" /> {busy ? t('approving') : t('approve')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
        disabled={busy}
        onClick={() => setDeclining(true)}
      >
        <XCircle className="size-3.5" /> {t('decline')}
      </Button>
    </div>
  );
}
