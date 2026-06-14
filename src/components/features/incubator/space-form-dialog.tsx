'use client';

/**
 * Dialog for creating or editing a space listing.
 * POST /api/incubator/spaces  (create)
 * PATCH /api/incubator/spaces/[id]  (edit)
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
import { GalleryUploadField } from '@/components/shared/gallery-upload-field';
import { AlgerianCitySelect } from '@/components/shared/algerian-city-select';
import type { SpaceCategory } from '@/types/domain';

const CATEGORY_KEYS: SpaceCategory[] = ['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION'];

// FIX: BUG-2 — added edit mode props
interface SpaceFormDialogProps {
  onCreated: () => void;
  editId?: string;
  initialData?: {
    name?: string; description?: string; category?: SpaceCategory;
    city?: string; pricePerHour?: number | null; pricePerDay?: number | null;
    pricePerMonth?: number | null;
    cashPricePerHour?: number | null; cashPricePerDay?: number | null; cashPricePerMonth?: number | null;
    capacity?: number; amenities?: string[];
    acceptedPaymentMethods?: ('ONLINE' | 'CASH')[]; imageUrl?: string | null;
    imageUrls?: string[] | null;
    cashDepositType?: 'FIXED' | 'PERCENT'; cashDepositValue?: number;
    workingDays?: number[]; openingTime?: string; closingTime?: string;
  };
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function SpaceFormDialog({ onCreated, editId, initialData, open: openProp, onOpenChange }: SpaceFormDialogProps) {
  const t = useTranslations('incubator.spaceForm');
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
  const [cashPricePerHour, setCashPricePerHour] = useState('');
  const [cashPricePerDay, setCashPricePerDay] = useState('');
  const [cashPricePerMonth, setCashPricePerMonth] = useState('');
  const [capacity, setCapacity] = useState('10');
  const [amenities, setAmenities] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<('ONLINE' | 'CASH')[]>(['ONLINE', 'CASH']);
  const [depositType, setDepositType] = useState<'FIXED' | 'PERCENT'>('PERCENT');
  const [depositValue, setDepositValue] = useState('10');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
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
      setCashPricePerHour(initialData.cashPricePerHour != null ? String(initialData.cashPricePerHour) : '');
      setCashPricePerDay(initialData.cashPricePerDay != null ? String(initialData.cashPricePerDay) : '');
      setCashPricePerMonth(initialData.cashPricePerMonth != null ? String(initialData.cashPricePerMonth) : '');
      setCapacity(initialData.capacity != null ? String(initialData.capacity) : '10');
      setAmenities((initialData.amenities ?? []).join(', '));
      setAcceptedMethods(initialData.acceptedPaymentMethods ?? ['ONLINE', 'CASH']);
      setDepositType(initialData.cashDepositType ?? 'PERCENT');
      setDepositValue(initialData.cashDepositValue != null ? String(initialData.cashDepositValue) : '10');
      setImageUrls(
        initialData.imageUrls?.length
          ? initialData.imageUrls
          : (initialData.imageUrl ? [initialData.imageUrl] : []),
      );
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
    setCashPricePerHour(''); setCashPricePerDay(''); setCashPricePerMonth('');
    setCapacity('10'); setAmenities('');
    setAcceptedMethods(['ONLINE', 'CASH']);
    setDepositType('PERCENT'); setDepositValue('10');
    setImageUrls([]);
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
      setError(t('errorPricing'));
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
          cashPricePerHour:  cashPricePerHour  ? Number(cashPricePerHour)  : null,
          cashPricePerDay:   cashPricePerDay   ? Number(cashPricePerDay)   : null,
          cashPricePerMonth: cashPricePerMonth ? Number(cashPricePerMonth) : null,
          capacity:      Number(capacity),
          amenities:     amenities.split(',').map((s) => s.trim()).filter(Boolean),
          acceptedPaymentMethods: acceptedMethods,
          ...(acceptedMethods.includes('CASH')
            ? { cashDepositType: depositType, cashDepositValue: Number(depositValue) }
            : { cashDepositType: null, cashDepositValue: null }),
          imageUrls,
          workingDays,
          openingTime,
          closingTime,
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
      {/* FIX: BUG-2 — only render trigger in create mode; edit mode is controlled externally */}
      {!editId && (
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <PlusCircle className="size-4" />
            {t('addSpace')}
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
              <Label htmlFor="s-name">{t('labelName')}</Label>
              <Input id="s-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="s-category">{t('labelCategory')}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SpaceCategory)}>
                <SelectTrigger id="s-category" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_KEYS.map((key) => {
                    const labelKey = `category${key.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join('')}` as 'categoryCoworking' | 'categoryPrivateOffice' | 'categoryTrainingRoom' | 'categoryDomiciliation';
                    return <SelectItem key={key} value={key}>{t(labelKey)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="s-city">{t('labelCity')}</Label>
              {/* FIX: BUG-4 — searchable wilaya dropdown */}
              <div className="mt-1">
                <AlgerianCitySelect id="s-city" value={city} onChange={setCity} required />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="s-desc">{t('labelDescription')}</Label>
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
              <GalleryUploadField
                label={t('labelCoverImage')}
                value={imageUrls}
                onChange={setImageUrls}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">{t('pricingLabel')}</p>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor="s-hour" className="text-xs text-muted-foreground">{t('perHour')}</Label>
                <Input id="s-hour" type="number" min="0" className="mt-1" value={pricePerHour} onChange={(e) => setPricePerHour(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="s-day" className="text-xs text-muted-foreground">{t('perDay')}</Label>
                <Input id="s-day" type="number" min="0" className="mt-1" value={pricePerDay} onChange={(e) => setPricePerDay(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="s-month" className="text-xs text-muted-foreground">{t('perMonth')}</Label>
                <Input id="s-month" type="number" min="0" className="mt-1" value={pricePerMonth} onChange={(e) => setPricePerMonth(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="s-cap">{t('labelCapacity')}</Label>
              <Input id="s-cap" type="number" min="1" className="mt-1" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="s-am">{t('labelAmenities')}</Label>
              <Input id="s-am" className="mt-1" value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder={t('amenitiesPlaceholder')} />
            </div>
          </div>

          {/* Working hours */}
          <div>
            <p className="text-sm font-medium">{t('workingHoursLabel')}</p>
            <div className="mt-2 space-y-3">
              {/* Days */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">{t('openDaysLabel')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { d: 1, label: t('dayMon') },
                    { d: 2, label: t('dayTue') },
                    { d: 3, label: t('dayWed') },
                    { d: 4, label: t('dayThu') },
                    { d: 5, label: t('dayFri') },
                    { d: 6, label: t('daySat') },
                    { d: 0, label: t('daySun') },
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
                  <Label htmlFor="s-open">{t('labelOpeningTime')}</Label>
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
                  <Label htmlFor="s-close">{t('labelClosingTime')}</Label>
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
              <p className="text-sm font-medium">{t('labelCashPricing')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('cashPricingHint')}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div>
                  <Label htmlFor="s-cash-hour" className="text-xs text-muted-foreground">{t('perHour')}</Label>
                  <Input id="s-cash-hour" type="number" min="0" className="mt-1" placeholder={pricePerHour || '0'} value={cashPricePerHour} onChange={(e) => setCashPricePerHour(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="s-cash-day" className="text-xs text-muted-foreground">{t('perDay')}</Label>
                  <Input id="s-cash-day" type="number" min="0" className="mt-1" placeholder={pricePerDay || '0'} value={cashPricePerDay} onChange={(e) => setCashPricePerDay(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="s-cash-month" className="text-xs text-muted-foreground">{t('perMonth')}</Label>
                  <Input id="s-cash-month" type="number" min="0" className="mt-1" placeholder={pricePerMonth || '0'} value={cashPricePerMonth} onChange={(e) => setCashPricePerMonth(e.target.value)} />
                </div>
              </div>
            </div>
          )}

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
              {submitting ? (editId ? t('saving') : t('creating')) : (editId ? t('saveChanges') : t('createSpace'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
