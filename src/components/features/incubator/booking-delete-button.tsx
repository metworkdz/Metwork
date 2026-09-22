'use client';

/**
 * Delete a booking off the list, or put a deleted one back.
 *
 * Deleting hides the row and moves it to the Deleted view; the record itself
 * stays, because a booking is the only evidence that money moved. The server
 * decides what may be deleted — only a booking holding no seat — so this
 * renders nothing on a confirmed one rather than offering a button that would
 * be refused.
 *
 * Silence is the default and is not negotiable for an unpaid attempt: those
 * people abandoned a checkout and an email about it would confuse them. The
 * `notify` option is offered only where it could mean something.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Undo2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  bookingId: string;
  /** Already deleted → this becomes a Restore button. */
  deleted?: boolean;
  /** Whether telling the client is even meaningful (never for an unpaid attempt). */
  canNotify?: boolean;
}

export function BookingDeleteButton({ bookingId, deleted = false, canNotify = false }: Props) {
  const t = useTranslations('incubator.bookingActions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(method: 'DELETE' | 'POST') {
    setError(null);
    setBusy(true);
    try {
      const qs = method === 'DELETE' && notify ? '?notify=true' : '';
      const res = await fetch(`/api/incubator/bookings/${bookingId}${qs}`, {
        method,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(body.error?.message ?? t('errorGeneric'));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        loading={busy}
        onClick={() => void run('POST')}
      >
        <Undo2 className="size-3.5" /> {t('restore')}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        title={t('deleteTitle')}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteBody')}</DialogDescription>
          </DialogHeader>

          {canNotify && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
              />
              <span>{t('deleteNotify')}</span>
            </label>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" loading={busy} onClick={() => void run('DELETE')}>
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
