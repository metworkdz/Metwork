'use client';

/**
 * Dialog for creating or editing an event listing.
 * POST /api/incubator/events  (create)
 * PATCH /api/incubator/events/[id]  (edit)
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
import { cn } from '@/lib/utils';
import { GalleryUploadField } from '@/components/shared/gallery-upload-field';
import { AlgerianCitySelect } from '@/components/shared/algerian-city-select';

// FIX: BUG-2 — added edit mode props
interface EventFormDialogProps {
  onCreated: () => void;
  editId?: string;
  initialData?: {
    title?: string; description?: string; city?: string; price?: number;
    onlinePrice?: number | null; cashPrice?: number | null;
    capacity?: number; isOnline?: boolean; eventDate?: string;
    acceptedPaymentMethods?: ('ONLINE' | 'CASH')[]; imageUrl?: string | null;
    imageUrls?: string[] | null;
    cashDepositType?: 'FIXED' | 'PERCENT'; cashDepositValue?: number;
  };
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function EventFormDialog({ onCreated, editId, initialData, open: openProp, onOpenChange }: EventFormDialogProps) {
  const t = useTranslations('incubator.eventForm');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [price, setPrice] = useState('0');
  const [onlinePrice, setOnlinePrice] = useState('');
  const [cashPrice, setCashPrice] = useState('');
  const [capacity, setCapacity] = useState('50');
  const [isOnline, setIsOnline] = useState(false);
  const [eventDate, setEventDate] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<('ONLINE' | 'CASH')[]>(['ONLINE', 'CASH']);
  const [depositType, setDepositType] = useState<'FIXED' | 'PERCENT'>('PERCENT');
  const [depositValue, setDepositValue] = useState('10');
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  // FIX: BUG-2 — pre-fill form when in edit mode
  useEffect(() => {
    if (editId && initialData) {
      setTitle(initialData.title ?? '');
      setDescription(initialData.description ?? '');
      setCity(initialData.city ?? '');
      setPrice(initialData.price != null ? String(initialData.price) : '0');
      setOnlinePrice(initialData.onlinePrice != null ? String(initialData.onlinePrice) : '');
      setCashPrice(initialData.cashPrice != null ? String(initialData.cashPrice) : '');
      setCapacity(initialData.capacity != null ? String(initialData.capacity) : '50');
      setIsOnline(initialData.isOnline ?? false);
      // FIX: BUG-2 — convert ISO date string back to YYYY-MM-DD for date input
      setEventDate(initialData.eventDate ? initialData.eventDate.substring(0, 10) : '');
      setAcceptedMethods(initialData.acceptedPaymentMethods ?? ['ONLINE', 'CASH']);
      setDepositType(initialData.cashDepositType ?? 'PERCENT');
      setDepositValue(initialData.cashDepositValue != null ? String(initialData.cashDepositValue) : '10');
      setImageUrls(
        initialData.imageUrls?.length
          ? initialData.imageUrls
          : (initialData.imageUrl ? [initialData.imageUrl] : []),
      );
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
    setTitle(''); setDescription(''); setCity('');
    setPrice('0'); setOnlinePrice(''); setCashPrice('');
    setCapacity('50'); setIsOnline(false); setEventDate('');
    setAcceptedMethods(['ONLINE', 'CASH']);
    setDepositType('PERCENT'); setDepositValue('10');
    setImageUrls([]);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // FIX: BUG-2 — use PATCH for edit mode, POST for create
      const url = editId ? `/api/incubator/events/${editId}` : '/api/incubator/events';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          city,
          price: Number(price),
          onlinePrice: onlinePrice.trim() === '' ? null : Number(onlinePrice),
          cashPrice: cashPrice.trim() === '' ? null : Number(cashPrice),
          capacity: Number(capacity),
          isOnline,
          eventDate: new Date(`${eventDate}T12:00:00`).toISOString(),
          acceptedPaymentMethods: acceptedMethods,
          ...(acceptedMethods.includes('CASH')
            ? { cashDepositType: depositType, cashDepositValue: Number(depositValue) }
            : { cashDepositType: null, cashDepositValue: null }),
          imageUrls,
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
            {t('addEvent')}
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
              <Label htmlFor="ev-title">{t('labelTitle')}</Label>
              <Input id="ev-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="ev-city">{t('labelCity')}</Label>
              {/* FIX: BUG-4 — searchable wilaya dropdown */}
              <div className="mt-1">
                <AlgerianCitySelect id="ev-city" value={city} onChange={setCity} required />
              </div>
            </div>
            <div>
              <Label htmlFor="ev-date">{t('labelEventDate')}</Label>
              <Input id="ev-date" type="date" className="mt-1" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ev-desc">{t('labelDescription')}</Label>
              <textarea
                id="ev-desc"
                className="mt-1 min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={10}
              />
            </div>
            <div className="sm:col-span-2">
              <GalleryUploadField
                label={t('labelBanner')}
                value={imageUrls}
                onChange={setImageUrls}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ev-price">{t('labelTicketPrice')}</Label>
              <Input id="ev-price" type="number" min="0" className="mt-1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ev-cap">{t('labelCapacity')}</Label>
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
            <Label htmlFor="ev-online" className="cursor-pointer text-sm">{t('labelOnlineEvent')}</Label>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">{t('labelSplitPricing')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('splitPricingHint')}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ev-online-price">{t('labelOnlinePrice')}</Label>
                <Input
                  id="ev-online-price"
                  type="number"
                  min="0"
                  className="mt-1"
                  placeholder={price}
                  value={onlinePrice}
                  onChange={(e) => setOnlinePrice(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ev-cash-price">{t('labelCashPrice')}</Label>
                <Input
                  id="ev-cash-price"
                  type="number"
                  min="0"
                  className="mt-1"
                  placeholder={price}
                  value={cashPrice}
                  onChange={(e) => setCashPrice(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">{t('labelPaymentMethods')}</p>
            <div className="mt-1.5 flex gap-3">
              {(['ONLINE', 'CASH'] as const).map((m) => {
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

          {acceptedMethods.includes('CASH') && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">{t('labelDeposit')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('depositHint')}</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex gap-2">
                  {(['PERCENT', 'FIXED'] as const).map((dt) => (
                    <button
                      key={dt}
                      type="button"
                      onClick={() => setDepositType(dt)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm transition-colors',
                        depositType === dt
                          ? 'border-primary bg-primary/5 font-medium text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {dt === 'PERCENT' ? t('depositPercent') : t('depositFixed')}
                    </button>
                  ))}
                </div>
                <div className="flex-1">
                  <Input
                    type="number"
                    min="1"
                    max={depositType === 'PERCENT' ? '100' : undefined}
                    className="w-full"
                    value={depositValue}
                    onChange={(e) => setDepositValue(e.target.value)}
                    required
                    aria-label={t('labelDeposit')}
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" loading={submitting}>
              {submitting ? (editId ? t('saving') : t('creating')) : (editId ? t('saveChanges') : t('createEvent'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
