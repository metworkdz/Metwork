'use client';

/**
 * Dialog for creating a new program listing.
 * POSTs to POST /api/incubator/programs.
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
import { ImageUploadField } from '@/components/shared/image-upload-field';
import type { ProgramType } from '@/types/domain';

const PROGRAM_TYPES: { value: ProgramType; label: string }[] = [
  { value: 'INCUBATION',   label: 'Incubation' },
  { value: 'ACCELERATION', label: 'Acceleration' },
  { value: 'TRAINING',     label: 'Training' },
  { value: 'BOOTCAMP',     label: 'Bootcamp' },
  { value: 'WORKSHOP',     label: 'Workshop' },
];

interface ProgramFormDialogProps {
  onCreated: () => void;
}

export function ProgramFormDialog({ onCreated }: ProgramFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProgramType>('INCUBATION');
  const [city, setCity] = useState('');
  const [price, setPrice] = useState('0');
  const [seatsTotal, setSeatsTotal] = useState('20');
  const [deadline, setDeadline] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<('ONLINE' | 'CASH')[]>(['ONLINE', 'CASH']);
  const [imageUrl, setImageUrl] = useState('');

  function toggleMethod(m: 'ONLINE' | 'CASH') {
    setAcceptedMethods((prev) => {
      if (prev.includes(m)) {
        const next = prev.filter((x) => x !== m);
        return next.length === 0 ? prev : next;
      }
      return [...prev, m];
    });
  }

  function reset() {
    setTitle(''); setDescription(''); setType('INCUBATION'); setCity('');
    setPrice('0'); setSeatsTotal('20'); setDeadline(''); setStartDate(''); setEndDate('');
    setAcceptedMethods(['ONLINE', 'CASH']);
    setImageUrl('');
    setError(null);
  }

  function toIso(dateLocal: string) {
    // Convert local date input (YYYY-MM-DD) to ISO string at noon local
    return new Date(`${dateLocal}T12:00:00`).toISOString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/incubator/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          type,
          city,
          price: Number(price),
          seatsTotal: Number(seatsTotal),
          deadline: toIso(deadline),
          startDate: toIso(startDate),
          endDate: toIso(endDate),
          acceptedPaymentMethods: acceptedMethods,
          imageUrl: imageUrl || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? 'Failed to create program.');
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
          Add program
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>
            Create an incubation, acceleration, or training program listing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="p-title">Title</Label>
              <Input id="p-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="p-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ProgramType)}>
                <SelectTrigger id="p-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROGRAM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-city">City</Label>
              <Input id="p-city" className="mt-1" value={city} onChange={(e) => setCity(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-desc">Description</Label>
              <textarea
                id="p-desc"
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-price">Price (DZD)</Label>
              <Input id="p-price" type="number" min="0" className="mt-1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-seats">Total seats</Label>
              <Input id="p-seats" type="number" min="1" className="mt-1" value={seatsTotal} onChange={(e) => setSeatsTotal(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-deadline">Application deadline</Label>
              <Input id="p-deadline" type="date" className="mt-1" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-start">Start date</Label>
              <Input id="p-start" type="date" className="mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-end">End date</Label>
              <Input id="p-end" type="date" className="mt-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
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
              {submitting ? 'Creating…' : 'Create program'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
