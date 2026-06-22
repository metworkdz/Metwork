'use client';

/**
 * Per-row Edit / Delete actions for an incubator's MANUAL (offline) bookings.
 * - Edit  → PUT  /api/incubator/bookings/:id (re-checks availability, emails the client)
 * - Delete→ DELETE /api/incubator/bookings/:id (removes it, emails the client)
 * Only rendered for manual bookings; online/card/wallet bookings keep the
 * existing confirm/cancel flow and never expose these controls.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Unit = 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';

export interface EditableBooking {
  id: string;
  itemName: string;
  startsAt: string;
  endsAt: string;
  unit: Unit;
  totalAmount: number;
  clientName: string;
  clientEmail: string;
  notes: string;
}

function toIso(date: string, time: string) {
  return `${date}T${time}:00.000Z`;
}

export function BookingRowActions({ booking }: { booking: EditableBooking }) {
  const t = useTranslations('incubator.bookingActions');
  const router = useRouter();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state (seeded from the row's current values)
  const [clientName, setClientName]   = useState(booking.clientName);
  const [clientEmail, setClientEmail] = useState(booking.clientEmail);
  const [startDate, setStartDate]     = useState(booking.startsAt.slice(0, 10));
  const [startTime, setStartTime]     = useState(booking.startsAt.slice(11, 16));
  const [endDate, setEndDate]         = useState(booking.endsAt.slice(0, 10));
  const [endTime, setEndTime]         = useState(booking.endsAt.slice(11, 16));
  const [unit, setUnit]               = useState<Unit>(booking.unit);
  const [amount, setAmount]           = useState(String(booking.totalAmount ?? 0));
  const [notes, setNotes]             = useState(booking.notes);

  function reseed() {
    setClientName(booking.clientName);
    setClientEmail(booking.clientEmail);
    setStartDate(booking.startsAt.slice(0, 10));
    setStartTime(booking.startsAt.slice(11, 16));
    setEndDate(booking.endsAt.slice(0, 10));
    setEndTime(booking.endsAt.slice(11, 16));
    setUnit(booking.unit);
    setAmount(String(booking.totalAmount ?? 0));
    setNotes(booking.notes);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const startsAt = toIso(startDate, startTime);
    const endsAt   = toIso(endDate, endTime);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError(t('errorEndAfterStart'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/incubator/bookings/${booking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt,
          endsAt,
          unit,
          totalAmount:  Number(amount) || 0,
          clientName:   clientName.trim(),
          clientEmail:  clientEmail.trim() || null,
          notes:        notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        setError(d.error?.message ?? t('errorGeneric'));
        return;
      }
      setEditOpen(false);
      router.refresh();
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/incubator/bookings/${booking.id}`, { method: 'DELETE' });
      // 404 = already gone → treat as success (idempotent from the user's view).
      if (!res.ok && res.status !== 404) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(d.error?.message ?? t('errorGeneric'));
        return;
      }
      setDeleteOpen(false);
      router.refresh();
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('menuLabel')}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={(e) => { e.preventDefault(); reseed(); setEditOpen(true); }}
          >
            <Pencil className="size-4" />
            {t('edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-destructive focus:text-destructive"
            onSelect={(e) => { e.preventDefault(); setError(null); setDeleteOpen(true); }}
          >
            <Trash2 className="size-4" />
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) reseed(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSave(e)} className="space-y-3 py-2 text-start">
            <div>
              <Label htmlFor="eb-client">{t('labelClientName')}</Label>
              <Input id="eb-client" className="mt-1" value={clientName}
                onChange={(e) => setClientName(e.target.value)} required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="eb-email">
                {t('labelClientEmail')}
                <span className="ms-1 text-xs text-muted-foreground">{t('emailReceiptHint')}</span>
              </Label>
              <Input id="eb-email" type="email" className="mt-1" value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)} maxLength={200} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="eb-sd">{t('labelStartDate')}</Label>
                <Input id="eb-sd" type="date" className="mt-1" value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
                  required />
              </div>
              <div>
                <Label htmlFor="eb-st">{t('labelStartTime')}</Label>
                <Input id="eb-st" type="time" className="mt-1" value={startTime}
                  onChange={(e) => setStartTime(e.target.value)} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="eb-ed">{t('labelEndDate')}</Label>
                <Input id="eb-ed" type="date" className="mt-1" value={endDate} min={startDate}
                  onChange={(e) => setEndDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="eb-et">{t('labelEndTime')}</Label>
                <Input id="eb-et" type="time" className="mt-1" value={endTime}
                  onChange={(e) => setEndTime(e.target.value)} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="eb-unit">{t('labelUnit')}</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                  <SelectTrigger id="eb-unit" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOUR">{t('unitHour')}</SelectItem>
                    <SelectItem value="HALF_DAY">{t('unitHalfDay')}</SelectItem>
                    <SelectItem value="DAY">{t('unitDay')}</SelectItem>
                    <SelectItem value="MONTH">{t('unitMonth')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="eb-amt">{t('labelAmount')}</Label>
                <Input id="eb-amt" type="number" min="0" className="mt-1" value={amount}
                  onChange={(e) => setAmount(e.target.value)} />
              </div>
            </div>

            <div>
              <Label htmlFor="eb-notes">{t('labelNotes')}</Label>
              <textarea
                id="eb-notes"
                className="mt-1 min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500}
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" loading={saving} disabled={!clientName.trim()}>{t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteDescription', { item: booking.itemName })}</DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>{t('cancel')}</Button>
            <Button type="button" variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
