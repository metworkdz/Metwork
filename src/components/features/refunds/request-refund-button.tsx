'use client';

/**
 * "Request a refund" for a payment the signed-in client made. It only opens a
 * request; an admin decides, and the client is emailed the outcome. The
 * server checks the payment belongs to them and that money was actually paid.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  sourceKind: 'BOOKING' | 'MENTOR_BOOKING';
  sourceId: string;
  size?: 'sm' | 'default';
}

export function RequestRefundButton({ sourceKind, sourceId, size = 'sm' }: Props) {
  const t = useTranslations('refunds.client');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/refunds', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKind, sourceId, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        const code = body?.error?.code;
        throw new Error(code === 'ALREADY_REFUNDED' ? t('errAlready') : code === 'TOO_LATE' ? t('errTooLate') : code === 'NOTHING_PAID' || code === 'NOT_REFUNDABLE' ? t('errNothing') : t('errGeneric'));
      }
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <span className="text-xs text-muted-foreground" role="status">{t('pending')}</span>;

  return (
    <>
      <Button size={size} variant="outline" onClick={() => { setOpen(true); setError(null); }}>{t('button')}</Button>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <Textarea id={`refund-reason-${sourceId}`} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>×</Button>
            <Button disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>{busy ? t('sending') : t('submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
