'use client';

/**
 * Manual (offline) booking dialog for incubators.
 * POSTs to POST /api/incubator/bookings.
 * Includes working-hours hints per selected space.
 */
import { useState } from 'react';
import { CalendarPlus, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClientPicker, type PickedClient } from './client-picker';
import type { SpaceCategory } from '@/types/domain';

interface SpaceOption {
  id: string;
  name: string;
  openingTime: string;
  closingTime: string;
  /** Category drives whether a desk/office unit must be selected. */
  category?: SpaceCategory;
  /** COWORKING desk names (the bookable units). */
  deskNames?: string[];
}

interface ManualBookingDialogProps {
  spaces: SpaceOption[];
  onCreated?: () => void;
}

export function ManualBookingDialog({ spaces, onCreated }: ManualBookingDialogProps) {
  const [open, setOpen]         = useState(false);
  const [submitting, setSub]    = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const [spaceId, setSpaceId]         = useState(spaces[0]?.id ?? '');
  const [deskName, setDeskName]       = useState('');
  const [client, setClient]           = useState<PickedClient | null>(null);
  const [clientName, setClientName]   = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [startDate, setStartDate]     = useState(today);
  const [startTime, setStartTime]     = useState('09:00');
  const [endDate, setEndDate]         = useState(today);
  const [endTime, setEndTime]         = useState('18:00');
  const [unit, setUnit]               = useState<'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH'>('HOUR');
  const [amount, setAmount]           = useState('');
  const [payMethod, setPayMethod]     = useState<'CASH' | 'ONLINE' | 'OTHER'>('CASH');
  const [notes, setNotes]             = useState('');

  const selectedSpace = spaces.find((s) => s.id === spaceId);
  // COWORKING → pick one of the space's desks; PRIVATE_OFFICE → the single office
  // unit (identified by the space name). Other categories need no unit selector.
  const requiresDesk = selectedSpace?.category === 'COWORKING';
  const requiresOffice = selectedSpace?.category === 'PRIVATE_OFFICE';
  const deskOptions = requiresDesk
    ? (selectedSpace?.deskNames ?? [])
    : requiresOffice && selectedSpace
      ? [selectedSpace.name]
      : [];

  function toIso(date: string, time: string) {
    return `${date}T${time}:00.000Z`;
  }

  function reset() {
    setClient(null);
    setClientName(''); setClientEmail(''); setStartDate(today); setStartTime('09:00');
    setEndDate(today); setEndTime('18:00'); setUnit('HOUR');
    setAmount(''); setPayMethod('CASH'); setNotes(''); setError(null); setSuccess(false);
    setDeskName('');
    if (spaces[0]) setSpaceId(spaces[0].id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const startsAt = toIso(startDate, startTime);
    const endsAt   = toIso(endDate,   endTime);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('End must be after start.');
      return;
    }
    if ((requiresDesk || requiresOffice) && !deskName) {
      setError(requiresOffice ? 'Please select an office.' : 'Please select a desk.');
      return;
    }
    setSub(true);
    try {
      const res = await fetch('/api/incubator/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          deskName: (requiresDesk || requiresOffice) ? deskName : undefined,
          clientName:  clientName.trim(),
          clientEmail: clientEmail.trim() || null,
          startsAt,
          endsAt,
          unit,
          totalAmount:   Number(amount) || 0,
          paymentMethod: payMethod,
          notes:         notes.trim() || null,
        }),
      });
      if (!res.ok) {
        // Two shapes: the structured desk-conflict body { error, deskName, date }
        // (a top-level string) and the standard envelope { error: { code, message } }.
        const d = await res.json().catch(() => ({})) as {
          error?: string | { code?: string; message?: string };
          date?: string;
        };
        if (d.error === 'DESK_ALREADY_BOOKED') {
          setError(`This desk is already booked for ${d.date ?? startDate}.`);
        } else {
          const code = typeof d.error === 'object' ? d.error?.code : undefined;
          if (code === 'OVERLAP_CONFLICT') {
            setError('This time slot is already booked. Please choose a different time.');
          } else {
            const msg = typeof d.error === 'object' ? d.error?.message : undefined;
            setError(msg ?? 'Failed to create booking.');
          }
        }
        return;
      }
      setSuccess(true);
      onCreated?.();
    } catch { setError('Network error — try again.'); }
    finally { setSub(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <CalendarPlus className="size-4" />
          Manual booking
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual / offline booking</DialogTitle>
          <DialogDescription>
            Record a booking made outside the platform (phone, walk-in, etc.).
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              Booking recorded successfully.
            </div>
            <DialogFooter>
              <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-2">
            {/* Space */}
            <div>
              <Label htmlFor="mb-space">Space *</Label>
              <Select value={spaceId} onValueChange={(v) => {
                setSpaceId(v);
                setDeskName('');
                const s = spaces.find((x) => x.id === v);
                if (s) { setStartTime(s.openingTime); setEndTime(s.closingTime); }
              }}>
                <SelectTrigger id="mb-space" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Desk / office unit — required for COWORKING + PRIVATE_OFFICE so the
                manual booking blocks the availability calendar. */}
            {(requiresDesk || requiresOffice) && (
              <div>
                <Label htmlFor="mb-desk">{requiresOffice ? 'Office' : 'Desk'} *</Label>
                <Select value={deskName} onValueChange={setDeskName}>
                  <SelectTrigger id="mb-desk" className="mt-1">
                    <SelectValue placeholder={requiresOffice ? 'Select an office…' : 'Select a desk…'} />
                  </SelectTrigger>
                  <SelectContent>
                    {deskOptions.length === 0 && (
                      <SelectItem value="__none__" disabled>No units</SelectItem>
                    )}
                    {deskOptions.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Working hours hint */}
            {selectedSpace && (
              <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Clock className="size-3.5 shrink-0" />
                Working hours: {selectedSpace.openingTime} – {selectedSpace.closingTime}
              </div>
            )}

            {/* Client — searchable picker with inline "add new" */}
            <div>
              <Label htmlFor="mb-client">Client *</Label>
              <div className="mt-1">
                <ClientPicker
                  id="mb-client"
                  value={client}
                  onSelect={(c) => {
                    setClient(c);
                    setClientName(c?.fullName ?? '');
                    setClientEmail(c?.email ?? '');
                  }}
                />
              </div>
            </div>

            {/* Client email — auto-filled from the selected client; editable for receipts */}
            <div>
              <Label htmlFor="mb-cemail">
                Client email
                <span className="ml-1 text-xs text-muted-foreground">(receipt sent if provided)</span>
              </Label>
              <Input id="mb-cemail" type="email" className="mt-1" value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)} maxLength={200}
                placeholder="client@email.com" />
            </div>

            {/* Start */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mb-sd">Start date *</Label>
                <Input id="mb-sd" type="date" className="mt-1" value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
                  required />
              </div>
              <div>
                <Label htmlFor="mb-st">Start time *</Label>
                <Input id="mb-st" type="time" className="mt-1" value={startTime}
                  onChange={(e) => setStartTime(e.target.value)} required />
              </div>
            </div>

            {/* End */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mb-ed">End date *</Label>
                <Input id="mb-ed" type="date" className="mt-1" value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="mb-et">End time *</Label>
                <Input id="mb-et" type="time" className="mt-1" value={endTime}
                  onChange={(e) => setEndTime(e.target.value)} required />
              </div>
            </div>

            {/* Unit + Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mb-unit">Billing unit</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH')}>
                  <SelectTrigger id="mb-unit" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOUR">Hourly</SelectItem>
                    <SelectItem value="HALF_DAY">Half-day</SelectItem>
                    <SelectItem value="DAY">Daily</SelectItem>
                    <SelectItem value="MONTH">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="mb-amt">Total amount (DZD)</Label>
                <Input id="mb-amt" type="number" min="0" className="mt-1" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </div>
            </div>

            {/* Payment method */}
            <div>
              <Label htmlFor="mb-pay">Payment method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as 'CASH' | 'ONLINE' | 'OTHER')}>
                <SelectTrigger id="mb-pay" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label htmlFor="mb-notes">Notes</Label>
              <textarea
                id="mb-notes"
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
              <Button type="submit" loading={submitting} disabled={!clientName.trim()}>Create booking</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
