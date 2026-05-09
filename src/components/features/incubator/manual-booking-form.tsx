'use client';

import { useState } from 'react';
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
  clientName: '',
  clientPhone: '',
  clientEmail: '',
  clientIdNumber: '',
  startsAt: '',
  endsAt: '',
  unit: 'DAY' as 'HOUR' | 'DAY' | 'MONTH',
  quantity: 1,
  totalAmount: 0,
};

export function ManualBookingForm({ spaces, programs, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = form.itemKind === 'SPACE' ? spaces : programs;

  function field<K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemId) { setError('Please select an item.'); return; }
    if (!form.clientName.trim()) { setError('Client name is required.'); return; }
    if (!form.clientPhone.trim()) { setError('Client phone is required.'); return; }
    if (!form.startsAt) { setError('Start date is required.'); return; }

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
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to create booking');
      onCreated(data.booking!);
      setOpen(false);
      setForm(EMPTY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Add manual booking
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(EMPTY); setError(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New manual booking</DialogTitle>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            {/* Item type + item */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.itemKind} onValueChange={(v) => { field('itemKind', v as 'SPACE' | 'PROGRAM'); field('itemId', ''); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SPACE">Space</SelectItem>
                    <SelectItem value="PROGRAM">Program</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{form.itemKind === 'SPACE' ? 'Space' : 'Program'} *</Label>
                <Select value={form.itemId} onValueChange={(v) => field('itemId', v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {items.length === 0 && (
                      <SelectItem value="__none__" disabled>No items</SelectItem>
                    )}
                    {form.itemKind === 'SPACE'
                      ? spaces.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                      : programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Client info */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mb-name">Client name *</Label>
                <Input id="mb-name" value={form.clientName} onChange={(e) => field('clientName', e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-phone">Client phone *</Label>
                <Input id="mb-phone" value={form.clientPhone} onChange={(e) => field('clientPhone', e.target.value)} placeholder="+213…" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mb-email">Client email</Label>
                <Input id="mb-email" type="email" value={form.clientEmail} onChange={(e) => field('clientEmail', e.target.value)} placeholder="optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-id">ID / Passport number</Label>
                <Input id="mb-id" value={form.clientIdNumber} onChange={(e) => field('clientIdNumber', e.target.value)} placeholder="optional" />
              </div>
            </div>

            {/* Dates + unit + quantity */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mb-start">Start date *</Label>
                <Input id="mb-start" type="date" value={form.startsAt} onChange={(e) => field('startsAt', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-end">End date</Label>
                <Input id="mb-end" type="date" value={form.endsAt} onChange={(e) => field('endsAt', e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={(v) => field('unit', v as 'HOUR' | 'DAY' | 'MONTH')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOUR">Hour</SelectItem>
                    <SelectItem value="DAY">Day</SelectItem>
                    <SelectItem value="MONTH">Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-qty">Quantity</Label>
                <Input id="mb-qty" type="number" min={1} value={form.quantity}
                  onChange={(e) => field('quantity', Math.max(1, parseInt(e.target.value, 10) || 1))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mb-amount">Amount (DZD)</Label>
                <Input id="mb-amount" type="number" min={0} value={form.totalAmount}
                  onChange={(e) => field('totalAmount', Math.max(0, parseInt(e.target.value, 10) || 0))} />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Create booking</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
