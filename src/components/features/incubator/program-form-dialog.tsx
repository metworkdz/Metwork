'use client';

/**
 * Dialog for creating or editing a program listing.
 * POST /api/incubator/programs  (create)
 * PATCH /api/incubator/programs/[id]  (edit)
 *
 * The markup is this surface's own; everything that decides what a program IS
 * — defaults, how a record loads back, what counts as valid, the request body —
 * comes from `@/lib/program-form`, shared with the consultant portal so the two
 * cannot drift again. See that file for what they had already drifted on.
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
import {
  PROGRAM_TYPES,
  emptyProgramForm,
  programFormFromRecord,
  programFormToPayload,
  togglePaymentMethod,
  validateProgramForm,
  type ProgramFormSource,
  type ProgramFormValues,
} from '@/lib/program-form';
import type { ProgramType } from '@/types/domain';
import { ProgramVisibilityField } from '@/components/features/programs/program-visibility-field';
import { DatesTbcToggle } from '@/components/features/programs/dates-tbc-toggle';

// FIX: BUG-2 — added edit mode props
interface ProgramFormDialogProps {
  onCreated: () => void;
  editId?: string;
  /**
   * The program being edited, narrowed by `toProgramFormSource`. Typed as the
   * shared shape rather than re-declared here — a local copy is what let the
   * start/end times fall out of the edit form unnoticed.
   */
  initialData?: ProgramFormSource;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}

export function ProgramFormDialog({ onCreated, editId, initialData, open: openProp, onOpenChange }: ProgramFormDialogProps) {
  const t = useTranslations('incubator.programForm');
  const tQuestions = useTranslations('defaultQuestions');
  // Shared with the consultant portal: one rule set, one set of messages.
  const tError = useTranslations('programFormErrors');
  const tApproval = useTranslations('accountApproval');
  const { isApproved } = useAccountApproved();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<ProgramFormValues>(emptyProgramForm);
  const set = <K extends keyof ProgramFormValues>(k: K, v: ProgramFormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Pre-fill when editing. `programFormFromRecord` owns the ISO→date-input
  // conversion, so the two surfaces read a stored program back identically.
  useEffect(() => {
    if (editId && initialData) {
      setForm(programFormFromRecord(initialData));
      setError(null);
    }
  }, [editId, initialData]);

  function reset() {
    setForm(emptyProgramForm());
    setError(null);
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
    // Shared validation. This surface used to rely on HTML `required` alone,
    // which never checked that the deadline falls before the start date.
    const invalid = validateProgramForm(form);
    if (invalid) { setError(tError(invalid)); return; }
    setSubmitting(true);
    try {
      // FIX: BUG-2 — use PATCH for edit mode, POST for create
      const url = editId ? `/api/incubator/programs/${editId}` : '/api/incubator/programs';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(programFormToPayload(form)),
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
              <Input id="p-title" className="mt-1" value={form.title} onChange={(e) => set('title', e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="p-type">{t('labelType')}</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as ProgramType)}>
                <SelectTrigger id="p-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROGRAM_TYPES.map((key) => {
                    const labelKey = `type${key.charAt(0)}${key.slice(1).toLowerCase()}` as 'typeIncubation' | 'typeAcceleration' | 'typeTraining' | 'typeBootcamp' | 'typeWorkshop' | 'typeWebinar';
                    return <SelectItem key={key} value={key}>{t(labelKey)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-city">{t('labelCity')}</Label>
              {/* FIX: BUG-4 — searchable wilaya dropdown */}
              <div className="mt-1">
                <AlgerianCitySelect id="p-city" value={form.city} onChange={(v) => set('city', v)} required />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="p-desc">{t('labelDescription')}</Label>
              <textarea
                id="p-desc"
                className="mt-1 min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                required
                minLength={10}
              />
            </div>
            <div className="sm:col-span-2">
              <GalleryUploadField
                label={t('labelCoverImage')}
                value={form.imageUrls}
                onChange={(v) => set('imageUrls', v)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-price">{t('labelPrice')}</Label>
              <Input id="p-price" type="number" min="0" className="mt-1" value={form.price} onChange={(e) => set('price', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-seats">{t('labelTotalSeats')}</Label>
              <Input id="p-seats" type="number" min="1" className="mt-1" value={form.seatsTotal} onChange={(e) => set('seatsTotal', e.target.value)} required />
            </div>
          </div>

          <DatesTbcToggle checked={form.datesTbc} onChange={(v) => set('datesTbc', v)} />

          {!form.datesTbc && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="p-deadline">{t('labelDeadline')}</Label>
              <Input id="p-deadline" type="date" className="mt-1" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-start">{t('labelStartDate')}</Label>
              <Input id="p-start" type="date" className="mt-1" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="p-start-time">{t('labelStartTime')}</Label>
              <Input id="p-start-time" type="time" className="mt-1" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">{t('startTimeHint')}</p>
            </div>
            <div>
              <Label htmlFor="p-end-time">{t('labelEndTime')}</Label>
              <Input id="p-end-time" type="time" className="mt-1" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-end">{t('labelEndDate')}</Label>
              <Input id="p-end" type="date" className="mt-1" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} required />
            </div>
          </div>
          )}

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
                  placeholder={form.price}
                  value={form.onlinePrice}
                  onChange={(e) => set('onlinePrice', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="p-cash-price">{t('labelCashPrice')}</Label>
                <Input
                  id="p-cash-price"
                  type="number"
                  min="0"
                  className="mt-1"
                  placeholder={form.price}
                  value={form.cashPrice}
                  onChange={(e) => set('cashPrice', e.target.value)}
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
                    onClick={() => set('acceptedPaymentMethods', togglePaymentMethod(form.acceptedPaymentMethods, m))}
                    className={cn(
                      'flex-1 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                      form.acceptedPaymentMethods.includes(m)
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

          {form.acceptedPaymentMethods.includes('CASH') && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">{t('labelDeposit')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('depositHint')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('depositZeroHint')}</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex gap-2">
                  {(['PERCENT', 'FIXED'] as const).map((dt) => (
                    <button
                      key={dt}
                      type="button"
                      onClick={() => set('cashDepositType', dt)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm transition-colors',
                        form.cashDepositType === dt
                          ? 'border-primary bg-primary/5 font-medium text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {dt === 'PERCENT' ? t('depositPercent') : t('depositFixed')}
                    </button>
                  ))}
                </div>
                <div className="flex-1">
                  {/* min 0 and NOT required: 0 or blank means "no deposit —
                      they pay the whole amount on site". `min="1" required`
                      made that impossible to enter at all, which is the
                      blocker hosts actually hit. */}
                  <Input
                    type="number"
                    min="0"
                    max={form.cashDepositType === 'PERCENT' ? '100' : undefined}
                    className="w-full"
                    value={form.cashDepositValue}
                    onChange={(e) => set('cashDepositValue', e.target.value)}
                    aria-label={t('labelDeposit')}
                  />
                </div>
              </div>
            </div>
          )}

          <ProgramVisibilityField value={form.visibility} onChange={(v) => set('visibility', v)} />

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
