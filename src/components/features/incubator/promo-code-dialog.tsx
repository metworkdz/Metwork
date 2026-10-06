'use client';

/**
 * Create or edit an incubator promo code.
 *
 * The form lives in an inner component so Radix unmounting the dialog content
 * on close gives a fresh draft on every open — no stale values from a cancelled
 * edit to reseed. Edit sends only what changed, so a rename never rewrites the
 * scope and a scope change never rewrites the discount.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PROMO_CODE_PATTERN, toLocalInput, type ScopedPromoCode } from '@/lib/promo-code-ui';
import {
  PromoScopePicker,
  type PickerProgram,
  type PickerSpace,
  type PromoScopeValue,
} from './promo-scope-picker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programs: PickerProgram[];
  spaces: PickerSpace[];
  /** Present → edit mode. */
  promo?: ScopedPromoCode | null;
  /** Create mode only: a program to tick up front (the per-program tab). */
  presetProgramId?: string;
  /** Called after a successful save, before the dialog closes. */
  onSaved?: () => void;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function PromoCodeForm({
  programs, spaces, promo, presetProgramId, onDone, onSaved,
}: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const t = useTranslations('incubator.promoCodes');
  const router = useRouter();
  const editing = !!promo;

  const [code, setCode] = useState(promo?.code ?? '');
  const [discount, setDiscount] = useState(promo ? String(promo.discountPercent) : '');
  const [expiresAt, setExpiresAt] = useState(toLocalInput(promo?.expiresAt ?? null));
  const [limit, setLimit] = useState(promo?.usageLimit != null ? String(promo.usageLimit) : '');
  const [scope, setScope] = useState<PromoScopeValue>({
    programIds: promo?.scope?.programIds ?? (presetProgramId ? [presetProgramId] : []),
    spaceIds: promo?.scope?.spaceIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const touch = () => setError(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = code.trim().toUpperCase();
    const pct = parseInt(discount, 10);
    if (!PROMO_CODE_PATTERN.test(name)) { setError(t('errCodeFormat')); return; }
    if (Number.isNaN(pct) || pct < 1 || pct > 100) { setError(t('errDiscountRange')); return; }
    if (scope.programIds.length + scope.spaceIds.length === 0) { setError(t('errScopeEmpty')); return; }

    const nextExpiry = expiresAt ? new Date(expiresAt).toISOString() : null;
    const nextLimit = limit ? parseInt(limit, 10) : null;

    let body: Record<string, unknown>;
    if (editing && promo) {
      body = {
        ...(name !== promo.code ? { code: name } : {}),
        ...(pct !== promo.discountPercent ? { discountPercent: pct } : {}),
        // Compared in the input's minute resolution: the stored instant carries seconds the control cannot show.
        ...(toLocalInput(promo.expiresAt) !== expiresAt ? { expiresAt: nextExpiry } : {}),
        ...(nextLimit !== promo.usageLimit ? { usageLimit: nextLimit } : {}),
        ...(!sameSet(scope.programIds, promo.scope?.programIds ?? []) || !sameSet(scope.spaceIds, promo.scope?.spaceIds ?? [])
          ? { programIds: scope.programIds, spaceIds: scope.spaceIds }
          : {}),
      };
      if (Object.keys(body).length === 0) { onDone(); return; }
    } else {
      body = {
        code: name,
        discountPercent: pct,
        expiresAt: nextExpiry,
        usageLimit: nextLimit,
        programIds: scope.programIds,
        spaceIds: scope.spaceIds,
      };
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing && promo ? `/api/incubator/promo-codes/${promo.id}` : '/api/incubator/promo-codes', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        const c = data.error?.code;
        setError(
          c === 'PROMO_CODE_EXISTS_INACTIVE' ? t('errCodeExistsInactive')
          : c === 'PROMO_CODE_EXISTS' ? t('errCodeExists')
          : c === 'PROMO_SCOPE_EMPTY' ? t('errScopeEmpty')
          : c === 'PROMO_SCOPE_INVALID' ? t('errScopeInvalid')
          // Server copy for the rest (e.g. an account still pending approval).
          : data.error?.message ?? t('errSave'),
        );
        return;
      }
      onSaved?.();
      router.refresh();
      onDone();
    } catch {
      setError(t('errNetwork'));
    } finally {
      setBusy(false);
    }
  }

  const noListings = programs.length + spaces.length === 0;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? t('editTitle') : t('newTitle')}</DialogTitle>
        <DialogDescription>{editing ? t('editNote') : t('newNote')}</DialogDescription>
      </DialogHeader>

      {noListings ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">{t('noListings')}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('colCode')} htmlFor="ipc-code" hint={t('codeHint')} required>
              <Input
                id="ipc-code"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); touch(); }}
                placeholder={t('codePlaceholder')}
                className="font-mono uppercase"
                autoComplete="off"
                maxLength={32}
              />
            </FormField>
            <FormField label={t('colDiscount')} htmlFor="ipc-discount" required>
              <Input
                id="ipc-discount"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                placeholder="20"
                value={discount}
                onChange={(e) => { setDiscount(e.target.value); touch(); }}
              />
            </FormField>
            <FormField label={t('colExpiry')} htmlFor="ipc-expires" hint={t('noExpiry')}>
              <Input id="ipc-expires" type="datetime-local" value={expiresAt} onChange={(e) => { setExpiresAt(e.target.value); touch(); }} />
            </FormField>
            <FormField label={t('colUsageLimit')} htmlFor="ipc-limit" hint={t('noLimit')}>
              <Input
                id="ipc-limit"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="50"
                value={limit}
                onChange={(e) => { setLimit(e.target.value); touch(); }}
              />
            </FormField>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              {t('validFor')} <span className="font-normal text-muted-foreground">— {t('pickAtLeastOne')}</span>
            </p>
            <PromoScopePicker
              programs={programs}
              spaces={spaces}
              value={scope}
              onChange={(v) => { setScope(v); touch(); }}
              disabled={busy}
            />
          </div>
        </>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>{t('cancel')}</Button>
        {!noListings && <Button type="submit" loading={busy}>{editing ? t('save') : t('create')}</Button>}
      </DialogFooter>
    </form>
  );
}

export function PromoCodeDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <PromoCodeForm {...rest} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
