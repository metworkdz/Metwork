'use client';

/**
 * Correct a participant's name, email or phone — and, for someone who pays at
 * the desk, the price and the amount paid.
 *
 * Not the answers, not the status — this is for fixing a typo or recording
 * money, not for rewriting what somebody submitted, and the server enforces
 * the same narrow shape. The price and the amount paid are the booking's: the
 * server writes them with the rule Réservations uses, so both pages agree. An
 * online payment is shown, read-only.
 *
 * Changing the email is the one edit with a consequence beyond the row: the
 * server refuses an address already used by another participant on the same
 * listing, because attendance de-duplicates by email and the two would merge
 * into one seat.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Registration } from '@/types/domain';
import type { Locale } from '@/i18n/config';
import { formatCurrency } from '@/lib/format';

interface Props {
  registration: Registration | null;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  onSaved: (updated: Registration) => void;
}

export function EditParticipantDialog({ registration, onOpenChange, endpoint, onSaved }: Props) {
  const t = useTranslations('registrationsTable');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('');
  const [paid, setPaid] = useState('');
  const lang = useLocale() as Locale;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row the fields were loaded from, so reopening reloads them. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (registration && loadedFor !== registration.id) {
    setLoadedFor(registration.id);
    setFullName(registration.fullName);
    setEmail(registration.email);
    setPhone(registration.phone);
    setPrice(String(registration.payment?.total ?? 0));
    setPaid(String(registration.payment?.paid ?? 0));
    setError(null);
  }

  async function save() {
    if (!registration) return;
    setError(null);
    // Only sent when it changed: a name fix must not trip over a payment rule.
    const payment = registration.payment;
    const total = Math.round(Number(price) || 0);
    const paidNow = Math.round(Number(paid) || 0);
    const money = payment?.editable && (total !== payment.total || paidNow !== payment.paid)
      ? { totalAmount: total, paidAmount: paidNow }
      : {};
    if (payment?.editable && paidNow > total) {
      setError(t('editPaidExceeds'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${endpoint}/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: registration.id, fullName, email, phone, ...money }),
      });
      const body = await res.json().catch(() => null) as
        { registration?: Registration; error?: { message?: string } } | null;

      if (!res.ok || !body?.registration) {
        setError(body?.error?.message ?? t('editFailed'));
        return;
      }
      onSaved(body.registration);
      onOpenChange(false);
    } catch {
      setError(t('editFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={registration !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="edit-name">{t('colName')}</Label>
            <Input
              id="edit-name"
              className="mt-1"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={160}
            />
          </div>
          <div>
            <Label htmlFor="edit-email">{t('colEmail')}</Label>
            <Input
              id="edit-email"
              type="email"
              className="mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={320}
            />
          </div>
          <div>
            <Label htmlFor="edit-phone">{t('colPhone')}</Label>
            <Input
              id="edit-phone"
              type="tel"
              dir="ltr"
              className="mt-1"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
            />
          </div>

          {registration?.payment?.editable && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="edit-price">{t('editPrice')}</Label>
                  <Input
                    id="edit-price" type="number" min={0} inputMode="numeric" className="mt-1"
                    value={price} onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-paid">{t('editPaid')}</Label>
                  <Input
                    id="edit-paid" type="number" min={0} inputMode="numeric" className="mt-1"
                    value={paid} onChange={(e) => setPaid(e.target.value)}
                  />
                </div>
              </div>
              {Math.round(Number(price) || 0) - Math.round(Number(paid) || 0) > 0 && (
                <p className="text-xs font-medium text-amber-600">
                  {t('editRemaining', {
                    amount: formatCurrency(Math.round(Number(price) || 0) - Math.round(Number(paid) || 0), lang),
                  })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t('editPaidHint')}</p>
            </div>
          )}
          {registration?.payment && !registration.payment.editable && registration.payment.total > 0 && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('editPaymentLocked', {
                paid: formatCurrency(registration.payment.paid, lang),
                total: formatCurrency(registration.payment.total, lang),
              })}
            </p>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('editCancel')}
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {t('editSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
