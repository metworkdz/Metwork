'use client';

/**
 * "Promo codes" tab on a program: the same codes as the Promo codes page,
 * filtered to the ones that work on THIS program.
 *
 * Contextual shortcuts only — create (with this program already ticked), attach
 * an existing code, detach. Anything that affects other programs too (deleting a
 * code, deactivating it) lives on the Promo codes page, which this panel links
 * to, so a click here can never silently change what another program offers.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Tag } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { ScopedPromoCode } from '@/lib/promo-code-ui';
import { PromoCodeDialog } from './promo-code-dialog';
import { PromoStatusBadge, PromoUsage, ScopeChips } from './promo-code-parts';
import type { PickerProgram, PickerSpace } from './promo-scope-picker';

export interface ProgramPromoData {
  codes: ScopedPromoCode[];
  programs: PickerProgram[];
  spaces: PickerSpace[];
}

interface Props extends ProgramPromoData {
  programId: string;
  programTitle: string;
}

async function patch(id: string, body: unknown): Promise<{ ok: boolean; code?: string; message?: string }> {
  const res = await fetch(`/api/incubator/promo-codes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  return { ok: false, code: data.error?.code, message: data.error?.message };
}

export function ProgramPromoCodesPanel({ programId, programTitle, codes, programs, spaces }: Props) {
  const t = useTranslations('incubator.promoCodes');
  const locale = useLocale() as Locale;
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScopedPromoCode | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const here = codes.filter((c) => c.scope?.programIds.includes(programId));
  const attachable = codes.filter((c) => !c.scope?.programIds.includes(programId));
  const totalUses = here.reduce((n, c) => n + c.usedCount, 0);

  async function detach(c: ScopedPromoCode) {
    setBusyId(c.id);
    setError(null);
    try {
      const r = await patch(c.id, { detach: { programIds: [programId] } });
      if (!r.ok) {
        // The last target cannot be removed: a code that works nowhere is a delete, not an edit.
        setError(r.code === 'PROMO_SCOPE_EMPTY' ? t('detachLast', { code: c.code }) : r.message ?? t('errSave'));
        return;
      }
      router.refresh();
    } catch {
      setError(t('errNetwork'));
    } finally {
      setBusyId(null);
    }
  }

  async function attachPicked() {
    setBusyId('attach');
    setError(null);
    try {
      for (const id of picked) {
        const r = await patch(id, { attach: { programIds: [programId] } });
        if (!r.ok) { setError(r.message ?? t('errSave')); return; }
      }
      setAttachOpen(false);
      setPicked([]);
      router.refresh();
    } catch {
      setError(t('errNetwork'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{t('panelTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('panelCount', { codes: here.length, uses: totalUses })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => { setError(null); setPicked([]); setAttachOpen(true); }}
            disabled={attachable.length === 0}
          >
            {t('attachExisting')}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t('newForProgram')}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>
      )}

      {here.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <Tag className="size-6 text-muted-foreground/50" />
          <p className="text-sm font-medium">{t('programEmptyTitle')}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{t('programEmptyDescription')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {here.map((c) => {
            const others = (c.scope?.programIds.length ?? 0) - 1 + (c.scope?.spaceIds.length ?? 0);
            return (
              <li key={c.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-base font-semibold tracking-wide">{c.code}</span>
                  <PromoStatusBadge promo={c} />
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span dir="ltr">{c.discountPercent}%</span>
                  <PromoUsage promo={c} />
                  <span>{t('colExpiry')}: {c.expiresAt ? formatDate(c.expiresAt, locale) : '—'}</span>
                </p>
                {others > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('alsoValidFor')}</p>
                    <ScopeChips promo={c} programs={programs} spaces={spaces} excludeProgramId={programId} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(c); setEditOpen(true); }} disabled={busyId === c.id}>
                    {t('edit')}
                  </Button>
                  <Button size="sm" variant="outline" loading={busyId === c.id} onClick={() => void detach(c)}>
                    {t('detach')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {t('detachNote')}{' '}
        <Link href="/dashboard/incubator/promo-codes" className="text-primary hover:underline">{t('manageAll')}</Link>
      </p>

      <PromoCodeDialog
        open={creating}
        onOpenChange={setCreating}
        programs={programs}
        spaces={spaces}
        presetProgramId={programId}
      />
      <PromoCodeDialog open={editOpen} onOpenChange={setEditOpen} programs={programs} spaces={spaces} promo={editing} />

      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('attachTitle')}</DialogTitle>
            <DialogDescription>{t('attachNote', { program: programTitle })}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 overflow-y-auto rounded-lg border border-border">
            {attachable.map((c) => (
              <li key={c.id} className="border-t border-border first:border-t-0">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-[18px] shrink-0 accent-[hsl(var(--primary))]"
                    checked={picked.includes(c.id)}
                    onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  />
                  <span className="flex-1 font-mono font-semibold">{c.code}</span>
                  <span className="text-xs text-muted-foreground">{c.discountPercent}%</span>
                  <PromoStatusBadge promo={c} />
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachOpen(false)} disabled={busyId === 'attach'}>{t('cancel')}</Button>
            <Button loading={busyId === 'attach'} disabled={picked.length === 0} onClick={() => void attachPicked()}>
              {t('attach')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
