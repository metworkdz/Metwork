'use client';

/**
 * Pieces shared by the full promo-codes page and the per-program tab, so the
 * two can never disagree about what a status means or how a code is deleted.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { promoStatus, type PromoStatus, type ScopedPromoCode } from '@/lib/promo-code-ui';
import type { PickerProgram, PickerSpace } from './promo-scope-picker';

const STATUS_VARIANT: Record<PromoStatus, 'success' | 'default' | 'danger'> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
  EXPIRED: 'danger',
  LIMIT_REACHED: 'danger',
};
const STATUS_KEY: Record<PromoStatus, string> = {
  ACTIVE: 'statusActive',
  INACTIVE: 'statusInactive',
  EXPIRED: 'statusExpired',
  LIMIT_REACHED: 'statusLimit',
};

export function PromoStatusBadge({ promo }: { promo: ScopedPromoCode }) {
  const t = useTranslations('incubator.promoCodes');
  const s = promoStatus(promo);
  return <Badge variant={STATUS_VARIANT[s]}>{t(STATUS_KEY[s])}</Badge>;
}

/** "14 / 50", or "3 / ∞" for an unlimited code. */
export function PromoUsage({ promo }: { promo: ScopedPromoCode }) {
  return (
    <span dir="ltr" className="whitespace-nowrap tabular-nums">
      {promo.usedCount} / {promo.usageLimit ?? '∞'}
    </span>
  );
}

/** The listings a code works on, as chips. Ids that no longer exist are counted, not hidden. */
export function ScopeChips({
  promo, programs, spaces, excludeProgramId,
}: {
  promo: ScopedPromoCode;
  programs: PickerProgram[];
  spaces: PickerSpace[];
  /** Per-program tab: leave out the program already named by the page. */
  excludeProgramId?: string;
}) {
  const t = useTranslations('incubator.promoCodes');
  const progById = new Map(programs.map((p) => [p.id, p.title]));
  const spaceById = new Map(spaces.map((s) => [s.id, s.name]));
  const progIds = (promo.scope?.programIds ?? []).filter((id) => id !== excludeProgramId);
  const spaceIds = promo.scope?.spaceIds ?? [];
  const missing =
    progIds.filter((id) => !progById.has(id)).length + spaceIds.filter((id) => !spaceById.has(id)).length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {progIds.filter((id) => progById.has(id)).map((id) => (
        <Badge key={`p-${id}`} variant="primary" className="max-w-[14rem] truncate" title={progById.get(id)}>
          {progById.get(id)}
        </Badge>
      ))}
      {spaceIds.filter((id) => spaceById.has(id)).map((id) => (
        <Badge key={`s-${id}`} variant="info" className="max-w-[14rem] truncate" title={spaceById.get(id)}>
          {spaceById.get(id)}
        </Badge>
      ))}
      {missing > 0 && <Badge variant="outline">{t('removedTargets', { count: missing })}</Badge>}
    </div>
  );
}

/** Deactivate / reactivate, and delete behind a confirm that points at the reversible option. */
export function PromoCodeActions({
  promo, onEdit, extra,
}: {
  promo: ScopedPromoCode;
  onEdit: () => void;
  extra?: React.ReactNode;
}) {
  const t = useTranslations('incubator.promoCodes');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/incubator/promo-codes/${promo.id}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });
      // 404 on delete = already gone (another tab); the list just needs a refresh.
      if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(data.error?.message ?? t('errSave'));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(t('errNetwork'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>{t('edit')}</Button>
        <Button size="sm" variant="outline" loading={busy} onClick={() => void call('PATCH', { isActive: !promo.isActive })}>
          {promo.isActive ? t('deactivate') : t('reactivate')}
        </Button>
        {extra}
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => { setError(null); setConfirm(true); }}
          disabled={busy}
        >
          {t('delete')}
        </Button>
      </div>
      {error && !confirm && <p className="mt-1 text-end text-xs text-destructive" role="alert">{error}</p>}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle', { code: promo.code })}</DialogTitle>
            <DialogDescription>{t('deleteBody', { count: promo.usedCount })}</DialogDescription>
          </DialogHeader>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>{t('cancel')}</Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => { if (await call('DELETE')) setConfirm(false); }}
            >
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
