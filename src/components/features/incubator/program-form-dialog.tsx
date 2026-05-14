'use client';

/**
 * Dialog for creating or editing a program listing.
 * POST /api/incubator/programs  (create)
 * PATCH /api/incubator/programs/[id]  (edit)
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import type { ProgramType } from '@/types/domain';

const PROGRAM_TYPE_KEYS: ProgramType[] = ['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP'];

// FIX: BUG-2 — added edit mode props; FIX: BUG-5 — added cashEnabled prop
interface ProgramFormDialogProps {
  onCreated: () => void;
  editId?: string;
  initialData?: {
    title?: string; description?: string; type?: ProgramType; city?: string;
    price?: number; seatsTotal?: number; deadline?: string; startDate?: string;
    endDate?: string; acceptedPaymentMethods?: ('ONLINE' | 'CASH')[]; imageUrl?: string | null;
  };
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  cashEnabled?: boolean;
}

export function ProgramFormDialog({ onCreated, editId, initialData, open: openProp, onOpenChange, cashEnabled = true }: ProgramFormDialogProps) {
  const t = useTranslations('incubator.programForm');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
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

  // FIX: BUG-2 — pre-fill form when in edit mode
  useEffect(() => {
    if (editId && initialData) {
      setTitle(initialData.title ?? '');
      setDescription(initialData.description ?? '');
      setType(initialData.type ?? 'INCUBATION');
      setCity(initialData.city ?? '');
      setPrice(initialData.price != null ? String(initialData.price) : '0');
      setSeatsTotal(initialData.seatsTotal != null ? String(initialData.seatsTotal) : '20');
      // FIX: BUG-2 — convert ISO date strings back to YYYY-MM-DD for date inputs
      setDeadline(initialData.deadline ? initialData.deadline.substring(0, 10) : '');
      setStartDate(initialData.startDate ? initialData.startDate.substring(0, 10) : '');
      setEndDate(initialData.endDate ? initialData.endDate.substring(0, 10) : '');
      setAcceptedMethods(initialData.acceptedPaymentMethods ?? ['ONLINE', 'CASH']);
      setImageUrl(initialData.imageUrl ?? '');
      setError(null);
    }
  }, [editId, initialData]);

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
      // FIX: BUG-2 — use PATCH for edit mode, POST for create
      const url = editId ? `/api/incubator/programs/${editId}` : '/api/incubator/programs';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
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
        setError(data.message ?? (editId ? t('errorUpdate') : t('errorCreate')));
        return;
      }
      onCreated();
      setOpen(false);
      reset();
    } catch {
      setError(t('errorNetwork'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      {/* FIX: BUG-2 — only render trigger in create mode */}
      {!editId && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <PlusCircle className="size-4" />
            {t('addProgram')}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editId ? t('titleEdit') : t('titleNew')}</DialogTitle>
          <DialogDescription>
            {editId ? t('descriptionEdit') : t('descriptionNew')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="p-title">{t('labelTitle')}</Label>
              <Input id="p-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="p-type">{t('labelType')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ProgramType)}>
                <SelectTrigger id="p-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROGRAM_TYPE_KEYS.map((key) => {
                    const labelKey = `type${key.charAt(0)}${key.slice(1).toLowerCase()}` as 'typeIncubation' | 'typeAcceleration' | 'typeTraining' | 'typeBootcamp' | 'typeWorkshop';
                    return <SelectItem key={key} value={key}>{t(labelKey)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-city">{t('labelCity')}</Label>
              {/* FIX: BUG-4 — searchable wilaya dropdown */}
              <div className="mt-1">
                <AlgerianCitySelect id="p-city" value={city} onChange={setCity} required />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-desc">{t('labelDescription')}</Label>
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
                label={t('labelCoverImage')}
                currentUrl={imageUrl || null}
                onUpload={(url) => setImageUrl(url)}
                onRemove={() => setImageUrl('')}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-price">{t('labelPrice')}</Label>
              <Input id="p-price" type="number" min="0" className="mt-1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-seats">{t('labelTotalSeats')}</Label>
              <Input id="p-seats" type="number" min="1" className="mt-1" value={seatsTotal} onChange={(e) => setSeatsTotal(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-deadline">{t('labelDeadline')}</Label>
              <Input id="p-deadline" type="date" className="mt-1" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-start">{t('labelStartDate')}</Label>
              <Input id="p-start" type="date" className="mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-end">{t('labelEndDate')}</Label>
              <Input id="p-end" type="date" className="mt-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">{t('labelPaymentMethods')}</p>
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
                    {m === 'ONLINE' ? t('methodOnline') : t('methodCash')}
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
              {submitting ? (editId ? t('saving') : t('creating')) : (editId ? t('saveChanges') : t('createProgram'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
