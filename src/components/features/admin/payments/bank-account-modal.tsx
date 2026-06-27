'use client';

/**
 * Add / Edit a payable target's payout bank account. Registers the SlickPay
 * beneficiary via /api/admin/payouts/bank-account. Bottom sheet on mobile,
 * centred dialog on desktop (Tailwind only).
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { MODAL_CONTENT_CLASS, type BankAccountMasked, type PayoutTargetType } from './types';

interface BankAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { type: PayoutTargetType; id: string; name: string; bankAccount: BankAccountMasked | null } | null;
  onSaved: () => void;
}

function ribIsValid(rib: string): boolean {
  return /^\d{20}$/.test(rib.replace(/\s+/g, ''));
}

export function BankAccountModal({ open, onOpenChange, target, onSaved }: BankAccountModalProps) {
  const t = useTranslations('admin.payments');
  const existing = target?.bankAccount ?? null;

  const [title, setTitle] = useState('');
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [address, setAddress] = useState('');
  const [rib, setRib] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(existing?.title ?? '');
    setFirstname(existing?.firstname ?? '');
    setLastname(existing?.lastname ?? '');
    setAddress(existing?.address ?? '');
    setRib('');
    setError(null);
  }, [open, existing]);

  const ribOk = ribIsValid(rib);
  const complete =
    title.trim() && firstname.trim() && lastname.trim() && address.trim() && ribOk;

  async function submit() {
    if (!target || !complete) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payouts/bank-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: target.type,
          targetId: target.id,
          title: title.trim(),
          firstname: firstname.trim(),
          lastname: lastname.trim(),
          address: address.trim(),
          rib: rib.replace(/\s+/g, ''),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to save');
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className={cn('max-w-md', MODAL_CONTENT_CLASS)}>
        <DialogHeader>
          <DialogTitle>{existing ? t('bank.editTitle') : t('bank.addTitle')}</DialogTitle>
          <DialogDescription>{t('bank.subtitle', { name: target?.name ?? '' })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.title')}</label>
            <Input className="mt-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('bank.titlePlaceholder')} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">{t('bank.firstName')}</label>
              <Input className="mt-1 text-sm" value={firstname} onChange={(e) => setFirstname(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('bank.lastName')}</label>
              <Input className="mt-1 text-sm" value={lastname} onChange={(e) => setLastname(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.address')}</label>
            <Input className="mt-1 text-sm" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('bank.rib')}</label>
            <Input
              inputMode="numeric"
              className="mt-1 font-mono text-sm tracking-wide"
              placeholder={existing ? t('bank.ribReplacePlaceholder', { masked: existing.ribMasked }) : t('bank.ribPlaceholder')}
              value={rib}
              onChange={(e) => setRib(e.target.value)}
            />
            {rib !== '' && !ribOk && <p className="mt-1 text-xs text-destructive">{t('bank.ribInvalid')}</p>}
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="default" loading={busy} disabled={!complete} onClick={submit}>{t('bank.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
