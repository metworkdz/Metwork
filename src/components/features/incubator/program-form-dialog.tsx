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
import { GalleryUploadField } from '@/components/shared/gallery-upload-field';
import { AlgerianCitySelect } from '@/components/shared/algerian-city-select';
import { buildDefaultApplicationFields } from '@/server/programs/default-application-questions';
import { useAccountApproved } from '@/hooks/use-account-approved';
import type { ProgramType } from '@/types/domain';

const PROGRAM_TYPE_KEYS: ProgramType[] = ['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP'];

// FIX: BUG-2 — added edit mode props
interface ProgramFormDialogProps {
  onCreated: () => void;
  editId?: string;
  initialData?: {
    title?: string; description?: string; type?: ProgramType; city?: string;
    price?: number; onlinePrice?: number | null; cashPrice?: number | null;
    seatsTotal?: number; deadline?: string; startDate?: string;
    endDate?: string; acceptedPaymentMethods?: ('ONLINE' | 'CASH')[]; imageUrl?: string | null;
    imageUrls?: string[] | null;
    cashDepositType?: 'FIXED' | 'PERCENT'; cashDepositValue?: number;
  };
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function ProgramFormDialog({ onCreated, editId, initialData, open: openProp, onOpenChange }: ProgramFormDialogProps) {
  const t = useTranslations('incubator.programForm');
  const tQuestions = useTranslations('defaultQuestions');
  const tApproval = useTranslations('accountApproval');
  const { isApproved } = useAccountApproved();
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
  const [onlinePrice, setOnlinePrice] = useState('');
  const [cashPrice, setCashPrice] = useState('');
  const [seatsTotal, setSeatsTotal] = useState('20');
  const [deadline, setDeadline] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<('ONLINE' | 'CASH')[]>(['ONLINE', 'CASH']);
  const [depositType, setDepositType] = useState<'FIXED' | 'PERCENT'>('PERCENT');
  const [depositValue, setDepositValue] = useState('10');
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  // FIX: BUG-2 — pre-fill form when in edit mode
  useEffect(() => {
    if (editId && initialData) {
      setTitle(initialData.title ?? '');
      setDescription(initialData.description ?? '');
      setType(initialData.type ?? 'INCUBATION');
      setCity(initialData.city ?? '');
      setPrice(initialData.price != null ? String(initialData.price) : '0');
      setOnlinePrice(initialData.onlinePrice != null ? String(initialData.onlinePrice) : '');
      setCashPrice(initialData.cashPrice != null ? String(initialData.cashPrice) : '');
      setSeatsTotal(initialData.seatsTotal != null ? String(initialData.seatsTotal) : '20');
      // FIX: BUG-2 — convert ISO date strings back to YYYY-MM-DD for date inputs
      setDeadline(initialData.deadline ? initialData.deadline.substring(0, 10) : '');
      setStartDate(initialData.startDate ? initialData.startDate.substring(0, 10) : '');
      setEndDate(initialData.endDate ? initialData.endDate.substring(0, 10) : '');
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
    setTitle(''); setDescription(''); setType('INCUBATION'); setCity('');
    setPrice('0'); setOnlinePrice(''); setCashPrice('');
    setSeatsTotal('20'); setDeadline(''); setStartDate(''); setEndDate('');
    setAcceptedMethods(['ONLINE', 'CASH']);
    setDepositType('PERCENT'); setDepositValue('10');
    setImageUrls([]);
    setError(null);
  }

  function toIso(dateLocal: string) {
    // Convert local date input (YYYY-MM-DD) to ISO string at noon local
    return new Date(`${dateLocal}T12:00:00`).toISOString();
  }

  // Seed a brand-new program's application form with the default question set,
  // localized to the incubator's current locale. Best-effort: never blocks
  // program creation (the builder's "Insert default questions" button is the
  // manual fallback). Runs on CREATE only — existing programs are never touched.
  async function seedDefaultQuestions(programId: string) {
    try {
      const fields = buildDefaultApplicationFields((k) => tQuestions(k));
      await fetch('/api/incubator/registration-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'PROGRAM', entityId: programId, fields }),
      });
    } catch {
      // swallow — seeding is non-critical
    }
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
          onlinePrice: onlinePrice.trim() === '' ? null : Number(onlinePrice),
          cashPrice: cashPrice.trim() === '' ? null : Number(cashPrice),
          seatsTotal: Number(seatsTotal),
          deadline: toIso(deadline),
          startDate: toIso(startDate),
          endDate: toIso(endDate),
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
      // On CREATE only, pre-populate the application form with default questions.
      if (!editId) {
        const created = await res.json().catch(() => null) as { id?: string } | null;
        if (created?.id) await seedDefaultQuestions(created.id);
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
        isApproved ? (
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <PlusCircle className="size-4" />
              {t('addProgram')}
            </Button>
          </DialogTrigger>
        ) : (
          <Button size="sm" className="gap-1.5" disabled title={tApproval('actionDisabled')}>
            <PlusCircle className="size-4" />
            {t('addProgram')}
          </Button>
        )
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg max-sm:inset-0 max-sm:h-full max-sm:max-h-full max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:pb-0 max-sm:pt-[calc(1.5rem+env(safe-area-inset-top))]">
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
              <GalleryUploadField
                label={t('labelCoverImage')}
                value={imageUrls}
                onChange={setImageUrls}
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

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">{t('labelSplitPricing')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('splitPricingHint')}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="p-online-price">{t('labelOnlinePrice')}</Label>
                <Input
                  id="p-online-price"
                  type="number"
                  min="0"
                  className="mt-1"
                  placeholder={price}
                  value={onlinePrice}
                  onChange={(e) => setOnlinePrice(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="p-cash-price">{t('labelCashPrice')}</Label>
                <Input
                  id="p-cash-price"
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

          <DialogFooter className="max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-6 max-sm:border-t max-sm:border-border max-sm:bg-background max-sm:px-6 max-sm:py-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Button type="submit" loading={submitting} className="max-sm:w-full">
              {submitting ? (editId ? t('saving') : t('creating')) : (editId ? t('saveChanges') : t('createProgram'))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
