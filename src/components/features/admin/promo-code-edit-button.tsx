'use client';

/**
 * Edit a promo code (name, discount, scope, limit, expiry).
 *
 * Edits only affect future redemptions — a checkout already quoted keeps the
 * price it was quoted — and the dialog says so, since an admin lowering a
 * discount mid-campaign would otherwise reasonably wonder.
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
import { toLocalInput } from '@/lib/promo-code-ui';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

type AppliesTo = 'ALL' | 'MEMBERSHIP' | 'SPACE' | 'CONSULTATION';

export interface EditablePromoCode {
  id: string;
  code: string;
  discountPercent: number;
  appliesTo: AppliesTo;
  expiresAt: string | null;
  usageLimit: number | null;
}

export function PromoCodeEditButton({ promo, owned = false }: { promo: EditablePromoCode; owned?: boolean }) {
  const t = useTranslations('admin.promoCodes');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(promo.code);
  const [discount, setDiscount] = useState(String(promo.discountPercent));
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(promo.appliesTo);
  const [expiresAt, setExpiresAt] = useState(toLocalInput(promo.expiresAt));
  const [usageLimit, setUsageLimit] = useState(promo.usageLimit === null ? '' : String(promo.usageLimit));

  function openDialog() {
    // Re-seed from the latest server data every time, so a stale draft from a
    // previous (cancelled) edit never survives a refresh.
    setCode(promo.code);
    setDiscount(String(promo.discountPercent));
    setAppliesTo(promo.appliesTo);
    setExpiresAt(toLocalInput(promo.expiresAt));
    setUsageLimit(promo.usageLimit === null ? '' : String(promo.usageLimit));
    setError(null);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const discountNum = parseInt(discount, 10);
    if (!code.trim()) { setError(t('codeRequired')); return; }
    if (Number.isNaN(discountNum) || discountNum < 1 || discountNum > 100) {
      setError(t('discountRange'));
      return;
    }
    // Send only what changed, so the audit entry names the real edits.
    const nextCode = code.trim().toUpperCase();
    const nextExpiry = expiresAt ? new Date(expiresAt).toISOString() : null;
    const nextLimit = usageLimit ? parseInt(usageLimit, 10) : null;
    const patch = {
      ...(nextCode !== promo.code ? { code: nextCode } : {}),
      ...(discountNum !== promo.discountPercent ? { discountPercent: discountNum } : {}),
      // An incubator-owned code is restricted by its scope, not by appliesTo — nothing to edit here.
      ...(!owned && appliesTo !== promo.appliesTo ? { appliesTo } : {}),
      // Compare in the input's own (minute-resolution) form: the stored instant has seconds/ms
      // that the datetime-local control cannot show, so an untouched field must not count as edited.
      ...(toLocalInput(promo.expiresAt) !== expiresAt ? { expiresAt: nextExpiry } : {}),
      ...(nextLimit !== promo.usageLimit ? { usageLimit: nextLimit } : {}),
    };
    if (Object.keys(patch).length === 0) { setOpen(false); return; }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        if (body.error?.code === 'PROMO_CODE_EXISTS_INACTIVE') setError(t('codeExistsInactive'));
        else if (res.status === 409) setError(t('codeExists'));
        else setError(body.error?.message ?? t('saveFailed'));
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
      <Button size="sm" variant="outline" onClick={openDialog}>{t('edit')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('editTitle')}</DialogTitle>
              <DialogDescription>{t('editNote')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('colCode')} htmlFor="pce-code" hint={t('renameHint')}>
                <Input
                  id="pce-code"
                  value={code}
                  onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
                  className="font-mono uppercase"
                />
              </FormField>
              <FormField label={t('colDiscount')} htmlFor="pce-discount">
                <Input
                  id="pce-discount"
                  type="number"
                  min={1}
                  max={100}
                  value={discount}
                  onChange={(e) => { setDiscount(e.target.value); setError(null); }}
                />
              </FormField>
              {!owned && (
              <FormField label={t('colAppliesTo')} htmlFor="pce-applies">
                <Select value={appliesTo} onValueChange={(v) => setAppliesTo(v as AppliesTo)}>
                  <SelectTrigger id="pce-applies"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t('allPurchases')}</SelectItem>
                    <SelectItem value="MEMBERSHIP">{t('membershipsOnly')}</SelectItem>
                    <SelectItem value="SPACE">{t('spaceBookingsOnly')}</SelectItem>
                    <SelectItem value="CONSULTATION">{t('consultationsOnly')}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              )}
              <FormField label={t('colUsageLimit')} htmlFor="pce-limit" hint={t('noLimit')}>
                <Input
                  id="pce-limit"
                  type="number"
                  min={1}
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                />
              </FormField>
              <FormField label={t('colExpiry')} htmlFor="pce-expires" hint={t('noExpiry')} className="sm:col-span-2">
                <Input
                  id="pce-expires"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </FormField>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>{t('cancel')}</Button>
              <Button type="submit" loading={busy}>{t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
