'use client';

/**
 * Dialog for creating a new space listing.
 * POSTs to POST /api/incubator/spaces.
 */
import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { SpaceCategory } from '@/types/domain';

const CATEGORIES: { value: SpaceCategory; label: string }[] = [
  { value: 'COWORKING',      label: 'Coworking' },
  { value: 'PRIVATE_OFFICE', label: 'Private office' },
  { value: 'TRAINING_ROOM',  label: 'Training room' },
  { value: 'DOMICILIATION',  label: 'Domiciliation' },
];

interface SpaceFormDialogProps {
  onCreated: () => void;
}

export function SpaceFormDialog({ onCreated }: SpaceFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SpaceCategory>('COWORKING');
  const [city, setCity] = useState('');
  const [pricePerHour, setPricePerHour] = useState('');
  const [pricePerDay, setPricePerDay] = useState('');
  const [pricePerMonth, setPricePerMonth] = useState('');
  const [capacity, setCapacity] = useState('10');
  const [amenities, setAmenities] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<('ONLINE' | 'CASH')[]>(['ONLINE', 'CASH']);
  // Working hours
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('18:00');

  function toggleMethod(m: 'ONLINE' | 'CASH') {
    setAcceptedMethods((prev) => {
      if (prev.includes(m)) {
        const next = prev.filter((x) => x !== m);
        return next.length === 0 ? prev : next; // must keep at least one
      }
      return [...prev, m];
    });
  }

  function reset() {
    setName(''); setDescription(''); setCategory('COWORKING'); setCity('');
    setPricePerHour(''); setPricePerDay(''); setPricePerMonth('');
    setCapacity('10'); setAmenities('');
    setAcceptedMethods(['ONLINE', 'CASH']);
    setWorkingDays([1, 2, 3, 4, 5]); setOpeningTime('09:00'); setClosingTime('18:00');
    setError(null);
  }

  function toggleDay(d: number) {
    setWorkingDays((prev) => {
      if (prev.includes(d)) {
        const next = prev.filter((x) => x !== d);
        return next.length === 0 ? prev : next; // keep at least one
      }
      return [...prev, d].sort((a, b) => a - b);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const hourVal  = pricePerHour  ? Number(pricePerHour)  : null;
    const dayVal   = pricePerDay   ? Number(pricePerDay)   : null;
    const monthVal = pricePerMonth ? Number(pricePerMonth) : null;

    if (hourVal == null && dayVal == null && monthVal == null) {
      setError('Set at least one pricing option (hourly, daily, or monthly).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/incubator/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          category,
          city,
          pricePerHour:  hourVal,
          pricePerDay:   dayVal,
          pricePerMonth: monthVal,
          capacity:      Number(capacity),
          amenities:     amenities.split(',').map((s) => s.trim()).filter(Boolean),
          acceptedPaymentMethods: acceptedMethods,
          workingDays,
          openingTime,
          closingTime,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? 'Failed to create space.');
        return;
      }
      onCreated();
      setOpen(false);
      reset();
    } catch {
      setError('Network error — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusCircle className="size-4" />
          Add space
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New space</DialogTitle>
          <DialogDescription>
            Fill in the details for your new coworking or office listing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="s-name">Name</Label>
              <Input id="s-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="s-category">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SpaceCategory)}>
                <SelectTrigger id="s-category" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="s-city">City</Label>
              <Input id="s-city" className="mt-1" value={city} onChange={(e) => setCity(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="s-desc">Description</Label>
              <textarea
                id="s-desc"
                className="mt-1 min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={10}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Pricing (DZD — fill at least one)</p>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor="s-hour" className="text-xs text-muted-foreground">Per hour</Label>
                <Input id="s-hour" type="number" min="0" className="mt-1" value={pricePerHour} onChange={(e) => setPricePerHour(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="s-day" className="text-xs text-muted-foreground">Per day</Label>
                <Input id="s-day" type="number" min="0" className="mt-1" value={pricePerDay} onChange={(e) => setPricePerDay(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="s-month" className="text-xs text-muted-foreground">Per month</Label>
                <Input id="s-month" type="number" min="0" className="mt-1" value={pricePerMonth} onChange={(e) => setPricePerMonth(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="s-cap">Capacity (seats)</Label>
              <Input id="s-cap" type="number" min="1" className="mt-1" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="s-am">Amenities (comma-separated)</Label>
              <Input id="s-am" className="mt-1" value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="WiFi, Coffee, …" />
            </div>
          </div>

          {/* Working hours */}
          <div>
            <p className="text-sm font-medium">Working hours</p>
            <div className="mt-2 space-y-3">
              {/* Days */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Open days</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { d: 1, label: 'Mon' },
                    { d: 2, label: 'Tue' },
                    { d: 3, label: 'Wed' },
                    { d: 4, label: 'Thu' },
                    { d: 5, label: 'Fri' },
                    { d: 6, label: 'Sat' },
                    { d: 0, label: 'Sun' },
                  ].map(({ d, label }) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        workingDays.includes(d)
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Times */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="s-open">Opening time</Label>
                  <Input
                    id="s-open"
                    type="time"
                    className="mt-1"
                    value={openingTime}
                    onChange={(e) => setOpeningTime(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="s-close">Closing time</Label>
                  <Input
                    id="s-close"
                    type="time"
                    className="mt-1"
                    value={closingTime}
                    onChange={(e) => setClosingTime(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Accepted payment methods</p>
            <div className="mt-1.5 flex gap-3">
              {(['ONLINE', 'CASH'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMethod(m)}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    acceptedMethods.includes(m)
                      ? 'border-primary bg-primary/5 font-medium text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  {m === 'ONLINE' ? 'Online (wallet)' : 'Cash on-site'}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" loading={submitting}>
              {submitting ? 'Creating…' : 'Create space'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
