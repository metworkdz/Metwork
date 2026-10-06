'use client';

/**
 * Permanently delete a promo code, which frees its name for reuse.
 *
 * Deactivate is the reversible option, so the dialog points at it. The
 * redemption count is shown because that is the number an admin would want to
 * glance at before removing a code that real customers have used.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  id: string;
  code: string;
  usedCount: number;
}

export function PromoCodeDeleteButton({ id, code, usedCount }: Props) {
  const t = useTranslations('admin.promoCodes');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      // 404 = already gone (another admin got there first) — the list just needs a refresh.
      if (!res.ok && res.status !== 404) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(body.error?.message ?? t('deleteFailed'));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => { setError(null); setOpen(true); }}
      >
        {t('delete')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle', { code })}</DialogTitle>
            <DialogDescription>{t('deleteBody', { count: usedCount })}</DialogDescription>
          </DialogHeader>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{t('cancel')}</Button>
            <Button variant="destructive" loading={busy} onClick={() => void remove()}>{t('deleteConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
