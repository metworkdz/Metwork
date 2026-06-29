'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { IncubatorSpaceRecord, IncubatorProgramRecord, BookingRecord } from '@/server/db/store';

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

interface Props {
  spaces: IncubatorSpaceRecord[];
  programs: IncubatorProgramRecord[];
  onCreated: (booking: BookingWithCustomer) => void;
}

const EMPTY = {
  itemKind: 'SPACE' as 'SPACE' | 'PROGRAM',
  itemId: '',
  deskName: '',
  clientName: '',
  clientPhone: '',
  clientEmail: '',
  clientIdNumber: '',
  startsAt: '',
  endsAt: '',
  unit: 'DAY' as 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH',
  quantity: 1,
  totalAmount: 0,
};

export function ManualBookingForm({ spaces, programs, onCreated }: Props) {
  const t = useTranslations('incubator.manualBookingForm');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = form.itemKind === 'SPACE' ? spaces : programs;

  // Resolve the selected space + whether it needs a desk/office unit selected.
  // COWORKING → one of space.deskNames; PRIVATE_OFFICE → the single office unit
  // (identified by the space name). Other categories need no unit selector.
  const selectedSpace = form.itemKind === 'SPACE'
    ? spaces.find((s) => s.id === form.itemId) ?? null
    : null;
  const requiresDesk = selectedSpace?.category === 'COWORKING';
  const requiresOffice = selectedSpace?.category === 'PRIVATE_OFFICE';
  const deskOptions = requiresDesk
    ? (selectedSpace?.deskNames ?? [])
    : requiresOffice && selectedSpace
      ? [selectedSpace.name]
      : [];

  function field<K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemId) { setError(t('errorSelectItem')); return; }
    if (requiresDesk && !form.deskName) { setError(t('errorSelectDesk')); return; }
    if (requiresOffice && !form.deskName) { setError(t('errorSelectOffice')); return; }
    if (!form.clientName.trim()) { setError(t('errorClientName')); return; }
    if (!form.clientPhone.trim()) { setError(t('errorClientPhone')); return; }
    if (!form.startsAt) { setError(t('errorStartDate')); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/incubator/manual-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itemKind: form.itemKind,
          itemId: form.itemId,
          deskName: (requiresDesk || requiresOffice) ? form.deskName : undefined,
          clientName: form.clientName.trim(),
          clientPhone: form.clientPhone.trim(),
          clientEmail: form.clientEmail.trim() || null,
          clientIdNumber: form.clientIdNumber.trim() || null,
          startsAt: form.startsAt,
          endsAt: form.endsAt || form.startsAt,
          unit: form.unit,
          quantity: form.quantity,
          totalAmount: form.totalAmount,
        }),
      });
      const data = await res.json() as { booking?: BookingWithCustomer; error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? t('errorCreate'));
      onCreated(data.booking!);
      setOpen(false);
      setForm(EMPTY);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorCreate'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        {t('addBooking')}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(EMPTY); setError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            {/* Item type + item */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('labelType')}</Label>
                <Select value={form.itemKind} onValueChange={(v) => { field('itemKind', v as 'SPACE' | 'PROGRAM'); field('itemId', ''); field('deskName', ''); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SPACE">{t('typeSpace')}</SelectItem>
                    <SelectItem value="PROGRAM">{t('typeProgram')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{form.itemKind === 'SPACE' ? t('typeSpace') : t('typeProgram')} *</Label>
                <Select value={form.itemId} onValueChange={(v) => { field('itemId', v); field('deskName', ''); }}>
                  <SelectTrigger><SelectValue placeholder={t('selectPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {items.length === 0 && (
                      <SelectItem value="__none__" disabled>{t('noItems')}</SelectItem>
                    )}
                    {form.itemKind === 'SPACE'
                      ? spaces.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                      : programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Desk / office unit — required for COWORKING + PRIVATE_OFFICE so the
                manual booking blocks the availability calendar. */}
            {(requiresDesk || requiresOffice) && (
              <div className="space-y-1.5">
                <Label>{requiresOffice ? t('labelOffice') : t('labelDesk')} *</Label>
                <Select value={form.deskName} onValueChange={(v) => field('deskName', v)}>
                  <SelectTrigger><SelectValue placeholder={t('selectDeskPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {deskOptions.length === 0 && (
                      <SelectItem value="__none__" disabled>{t('noItems')}</SelectItem>
                    )}
                    {deskOptions.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Client info */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mb-name">{t('labelClientName')}</Label>
                <Input id="mb-name" value={form.clientName} onChange={(e) => field('clientName', e.target.value)} placeholder={t('clientNamePlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-phone">{t('labelClientPhone')}</Label>
                <Input id="mb-phone" value={form.clientPhone} onChange={(e) => field('clientPhone', e.target.value)} placeholder={t('clientPhonePlaceholder')} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mb-email">{t('labelClientEmail')}</Label>
                <Input id="mb-email" type="email" value={form.clientEmail} onChange={(e) => field('clientEmail', e.target.value)} placeholder={t('optional')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-id">{t('labelIdPassport')}</Label>
                <Input id="mb-id" value={form.clientIdNumber} onChange={(e) => field('clientIdNumber', e.target.value)} placeholder={t('optional')} />
              </div>
            </div>

            {/* Dates + unit + quantity */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mb-start">{t('labelStartDate')}</Label>
                <Input id="mb-start" type="date" value={form.startsAt} onChange={(e) => field('startsAt', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-end">{t('labelEndDate')}</Label>
                <Input id="mb-end" type="date" value={form.endsAt} onChange={(e) => field('endsAt', e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t('labelUnit')}</Label>
                <Select value={form.unit} onValueChange={(v) => field('unit', v as 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOUR">{t('unitHour')}</SelectItem>
                    <SelectItem value="HALF_DAY">{t('unitHalfDay')}</SelectItem>
                    <SelectItem value="DAY">{t('unitDay')}</SelectItem>
                    <SelectItem value="MONTH">{t('unitMonth')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-qty">{t('labelQuantity')}</Label>
                <Input id="mb-qty" type="number" min={1} value={form.quantity}
                  onChange={(e) => field('quantity', Math.max(1, parseInt(e.target.value, 10) || 1))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-amount">{t('labelAmount')}</Label>
                <Input id="mb-amount" type="number" min={0} value={form.totalAmount}
                  onChange={(e) => field('totalAmount', Math.max(0, parseInt(e.target.value, 10) || 0))} />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" loading={saving}>{t('createBooking')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
