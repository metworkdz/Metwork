'use client';

/**
 * Per-row Edit / Cancel / Delete actions for an incubator's MANUAL (offline) bookings.
 * - Edit   → PUT  /api/incubator/bookings/:id (re-checks availability, emails the client)
 * - Cancel → POST /api/incubator/bookings/:id/cancel-reservation (frees the desk, no money moves)
 * - Delete → DELETE /api/incubator/bookings/:id (hides it; restorable from the Deleted view)
 * A reservation that still holds its desk cannot be deleted, so Delete on one
 * explains that and offers the cancel right there instead of failing after the
 * fact. Only rendered for manual bookings; online/card/wallet bookings keep the
 * existing confirm/cancel flow and never expose these controls.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
  itemKind: 'SPACE' | 'PROGRAM' | 'EVENT';
  itemName: string;
  startsAt: string;
  endsAt: string;
  unit: Unit;
  totalAmount: number;
  /** What has been handed over so far (see `@/server/bookings/desk-payment`). */
  paidAmount: number;
  /** A confirmed cash booking — the only kind whose amount paid can change. */
  paymentEditable: boolean;
  clientName: string;
  clientEmail: string;
  notes: string;
  /** Still occupies its desk/seat — so it cannot be deleted until it is cancelled. */
  holdsSeat: boolean;
  /** The host may cancel it from here (a manual booking that holds a seat). */
  canCancel: boolean;
}

function toIso(date: string, time: string) {
  return `${date}T${time}:00.000Z`;
}

export function BookingRowActions({ booking }: { booking: EditableBooking }) {
  const t = useTranslations('incubator.bookingActions');
  const router = useRouter();

  const [editOpen, setEditOpen] = useState(false);
  // Which confirm is showing. Delete on a booking that holds its desk shows the
  // cancel-first explanation in the same dialog, then turns into the delete
  // confirm by itself once the refreshed booking no longer holds a seat.
  const [dialog, setDialog] = useState<null | 'cancel' | 'delete'>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notifyClient, setNotifyClient] = useState(false);
  const [justCancelled, setJustCancelled] = useState(false);
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
  const [paid, setPaid]               = useState(String(booking.paidAmount ?? 0));
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
    setPaid(String(booking.paidAmount ?? 0));
    setNotes(booking.notes);
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const startsAt = toIso(startDate, startTime);
    const endsAt   = toIso(endDate, endTime);
    // Same start and end is a one-day program or event; only a space needs a span.
    const end = new Date(endsAt), start = new Date(startsAt);
    if (booking.itemKind === 'SPACE' ? end <= start : end < start) {
      setError(t('errorEndAfterStart'));
      return;
    }
    const total = Math.round(Number(amount) || 0);
    const paidNow = Math.round(Number(paid) || 0);
    if (booking.paymentEditable && paidNow > total) {
      setError(t('errorPaidExceeds'));
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
          totalAmount:  total,
          ...(booking.paymentEditable ? { paidAmount: paidNow } : {}),
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

  async function handleCancel() {
    setError(null);
    setCancelling(true);
    try {
      const qs = notifyClient && booking.clientEmail ? '?notify=true' : '';
      const res = await fetch(`/api/incubator/bookings/${booking.id}/cancel-reservation${qs}`, {
        method: 'POST',
        credentials: 'include',
      });
      // 409 ALREADY_FINAL = cancelled in another tab; the refresh below shows the truth.
      if (!res.ok && res.status !== 409) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(d.error?.message ?? t('errorGeneric'));
        return;
      }
      setJustCancelled(true);
      // From Delete the dialog stays open and flips to the delete confirm once the
      // refreshed row no longer holds a seat; from Cancel there is nothing left to do.
      if (dialog === 'cancel') setDialog(null);
      router.refresh();
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setCancelling(false);
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
      setDialog(null);
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
          {booking.canCancel && (
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={(e) => { e.preventDefault(); setError(null); setNotifyClient(false); setDialog('cancel'); }}
            >
              <Ban className="size-4" />
              {t('cancelReservation')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-destructive focus:text-destructive"
            onSelect={(e) => { e.preventDefault(); setError(null); setNotifyClient(false); setJustCancelled(false); setDialog('delete'); }}
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

            {booking.paymentEditable && (
              <div>
                <Label htmlFor="eb-paid">{t('labelPaid')}</Label>
                <Input id="eb-paid" type="number" min="0" inputMode="numeric" className="mt-1" value={paid}
                  onChange={(e) => setPaid(e.target.value)} aria-describedby="eb-paid-hint" />
                <p id="eb-paid-hint" className="mt-1 text-xs text-muted-foreground">{t('paidHint')}</p>
              </div>
            )}

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

      {/* Cancel / Delete confirm */}
      <Dialog open={dialog !== null} onOpenChange={(v) => { if (!v) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          {(dialog === 'cancel' || (dialog === 'delete' && booking.holdsSeat)) ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog === 'delete' ? t('holdsSeatTitle') : t('cancelTitle')}
                </DialogTitle>
                <DialogDescription>
                  {dialog === 'delete' && !booking.canCancel
                    ? t('holdsSeatNoCancel')
                    : dialog === 'delete'
                      ? t('holdsSeatBody', { item: booking.itemName })
                      : t('cancelBody', { item: booking.itemName })}
                </DialogDescription>
              </DialogHeader>

              {booking.canCancel && (
                <>
                  {booking.paidAmount > 0 && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {t('cancelPaidWarning', { amount: `${booking.paidAmount.toLocaleString()} DZD` })}
                    </p>
                  )}
                  {booking.clientEmail && (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4"
                        checked={notifyClient}
                        onChange={(e) => setNotifyClient(e.target.checked)}
                      />
                      <span>{t('cancelNotify')}</span>
                    </label>
                  )}
                </>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={cancelling}>
                  {t('keepReservation')}
                </Button>
                {booking.canCancel && (
                  <Button type="button" variant="destructive" loading={cancelling} onClick={() => void handleCancel()}>
                    {t('cancelConfirm')}
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('deleteTitle')}</DialogTitle>
                <DialogDescription>{t('deleteDescription', { item: booking.itemName })}</DialogDescription>
              </DialogHeader>
              {justCancelled && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">
                  {t('cancelledNowDelete')}
                </p>
              )}
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>{t('cancel')}</Button>
                <Button type="button" variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
                  {t('deleteConfirm')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
