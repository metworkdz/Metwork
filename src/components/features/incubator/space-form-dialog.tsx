'use client';

/**
 * Dialog for creating or editing a space listing.
 * POST /api/incubator/spaces  (create)
 * PATCH /api/incubator/spaces/[id]  (edit)
 */
import { useEffect, useState } from 'react';
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
import { ImageUploadField } from '@/components/shared/image-upload-field';
import { AlgerianCitySelect } from '@/components/shared/algerian-city-select';
import type { SpaceCategory } from '@/types/domain';

const CATEGORIES: { value: SpaceCategory; label: string }[] = [
  { value: 'COWORKING',      label: 'Coworking' },
  { value: 'PRIVATE_OFFICE', label: 'Private office' },
  { value: 'TRAINING_ROOM',  label: 'Training room' },
  { value: 'DOMICILIATION',  label: 'Domiciliation' },
];

// FIX: BUG-2 — added edit mode props; FIX: BUG-5 — added cashEnabled prop
interface SpaceFormDialogProps {
  onCreated: () => void;
  editId?: string;
  initialData?: {
    name?: string; description?: string; category?: SpaceCategory;
    city?: string; pricePerHour?: number | null; pricePerDay?: number | null;
    pricePerMonth?: number | null; capacity?: number; amenities?: string[];
    acceptedPaymentMethods?: ('ONLINE' | 'CASH')[]; imageUrl?: string | null;
    workingDays?: number[]; openingTime?: string; closingTime?: string;
  };
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  cashEnabled?: boolean;
}

export function SpaceFormDialog({ onCreated, editId, initialData, open: openProp, onOpenChange, cashEnabled = true }: SpaceFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
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
  const [imageUrl, setImageUrl] = useState('');
  // Working hours
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('18:00');

  // FIX: BUG-2 — pre-fill form when in edit mode
  useEffect(() => {
    if (editId && initialData) {
      setName(initialData.name ?? '');
      setDescription(initialData.description ?? '');
      setCategory(initialData.category ?? 'COWORKING');
      setCity(initialData.city ?? '');
      setPricePerHour(initialData.pricePerHour != null ? String(initialData.pricePerHour) : '');
      setPricePerDay(initialData.pricePerDay != null ? String(initialData.pricePerDay) : '');
      setPricePerMonth(initialData.pricePerMonth != null ? String(initialData.pricePerMonth) : '');
      setCapacity(initialData.capacity != null ? String(initialData.capacity) : '10');
      setAmenities((initialData.amenities ?? []).join(', '));
      setAcceptedMethods(initialData.acceptedPaymentMethods ?? ['ONLINE', 'CASH']);
      setImageUrl(initialData.imageUrl ?? '');
      setWorkingDays(initialData.workingDays ?? [1, 2, 3, 4, 5]);
      setOpeningTime(initialData.openingTime ?? '09:00');
      setClosingTime(initialData.closingTime ?? '18:00');
      setError(null);
    }
  }, [editId, initialData]);

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
    setImageUrl('');
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
      // FIX: BUG-2 — use PATCH for edit mode, POST for create
      const url = editId ? `/api/incubator/spaces/${editId}` : '/api/incubator/spaces';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
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
          imageUrl:      imageUrl || null,
          workingDays,
          openingTime,
          closingTime,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? (editId ? 'Failed to update space.' : 'Failed to create space.'));
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
      {/* FIX: BUG-2 — only render trigger in create mode; edit mode is controlled externally */}
      {!editId && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <PlusCircle className="size-4" />
            Add space
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editId ? 'Edit space' : 'New space'}</DialogTitle>
          <DialogDescription>
            {editId
              ? 'Update the details for this space listing.'
              : 'Fill in the details for your new coworking or office listing.'}
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
              {/* FIX: BUG-4 — searchable wilaya dropdown */}
              <div className="mt-1">
                <AlgerianCitySelect id="s-city" value={city} onChange={setCity} required />
              </div>
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
            <div className="sm:col-span-2">
              <ImageUploadField
                label="Cover image (optional)"
                currentUrl={imageUrl || null}
                onUpload={(url) => setImageUrl(url)}
                onRemove={() => setImageUrl('')}
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
              {(['ONLINE', 'CASH'] as const).map((m) => {
                // FIX: BUG-5 — hide CASH button when cash is not allowed for this subscription
                if (m === 'CASH' && !cashEnabled) return null;
                return (
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
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" loading={submitting}>
              {submitting ? (editId ? 'Saving…' : 'Creating…') : (editId ? 'Save changes' : 'Create space')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
