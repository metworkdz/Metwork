'use client';

/**
 * Dialog for creating a new event listing.
 * POSTs to POST /api/incubator/events.
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
import { cn } from '@/lib/utils';

interface EventFormDialogProps {
  onCreated: () => void;
}

export function EventFormDialog({ onCreated }: EventFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [price, setPrice] = useState('0');
  const [capacity, setCapacity] = useState('50');
  const [isOnline, setIsOnline] = useState(false);
  const [eventDate, setEventDate] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<('ONLINE' | 'CASH')[]>(['ONLINE', 'CASH']);

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
    setTitle(''); setDescription(''); setCity('');
    setPrice('0'); setCapacity('50'); setIsOnline(false); setEventDate('');
    setAcceptedMethods(['ONLINE', 'CASH']);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/incubator/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          city,
          price: Number(price),
          capacity: Number(capacity),
          isOnline,
          eventDate: new Date(`${eventDate}T12:00:00`).toISOString(),
          acceptedPaymentMethods: acceptedMethods,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? 'Failed to create event.');
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
          Add event
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Create a networking event, demo day, or workshop.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="ev-title">Title</Label>
              <Input id="ev-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="ev-city">City</Label>
              <Input id="ev-city" className="mt-1" value={city} onChange={(e) => setCity(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="ev-date">Event date</Label>
              <Input id="ev-date" type="date" className="mt-1" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ev-desc">Description</Label>
              <textarea
                id="ev-desc"
                className="mt-1 min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={10}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ev-price">Ticket price (DZD, 0 = free)</Label>
              <Input id="ev-price" type="number" min="0" className="mt-1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ev-cap">Capacity</Label>
              <Input id="ev-cap" type="number" min="1" className="mt-1" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="ev-online"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={isOnline}
              onChange={(e) => setIsOnline(e.target.checked)}
            />
            <Label htmlFor="ev-online" className="cursor-pointer text-sm">Online event (virtual)</Label>
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
                  {m === 'ONLINE' ? 'Online (wallet)' : 'Cash at door'}
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
              {submitting ? 'Creating…' : 'Create event'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
