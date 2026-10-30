'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';

/** Refund to the Metwork wallet, with an inline confirmation step. */
export function RefundButton({ enrollmentId, label, until }: { enrollmentId: string; label: string; until: string }) {
  const t = useTranslations('academy.my');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {label} · {t('until', { date: until })}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t('refundConfirm')}</span>
      <Button size="sm" variant="destructive" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(false);
        try { await apiClient.post(`/academy/enrollments/${enrollmentId}/refund`); router.refresh(); }
        catch { setError(true); setBusy(false); }
      }}>{busy && <Loader2 className="me-1 size-3.5 animate-spin" />}{t('refundYes')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t('refundNo')}</Button>
      {error && <span className="text-destructive">{t('refundError')}</span>}
    </div>
  );
}
