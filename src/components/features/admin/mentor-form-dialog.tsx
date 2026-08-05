'use client';

/**
 * Add / edit mentor dialog. Lives inside the admin mentors page; the
 * trigger button is owned by the parent so this component is fully
 * controlled (open + onOpenChange + initial mentor).
 *
 * Design notes:
 *   - Two-column layout on desktop: form on the start, live preview card
 *     on the end. The preview is a faithful copy of the landing-page
 *     `MentorCard` so admins see exactly what visitors will see.
 *   - File input uploads through `/api/mentors/upload`, then sets the
 *     URL on the form. The URL field is also editable directly so
 *     admins can paste an external image URL.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ImagePlus, Linkedin, Loader2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/ui/multi-select';
import { mentorsService } from '@/services/mentors.service';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { getMentorCategoryLabel } from '@/lib/mentor-categories';
import { LandingMentorCard } from '@/components/features/mentors/landing-mentor-card';
import type { Mentor, MentorInput } from '@/types/mentor';
import type { MentorCategoryRecord } from '@/server/db/store';

interface MentorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the form is in "edit" mode. */
  initial?: Mentor | null;
  onSaved: (mentor: Mentor) => void;
  /** Full category roster (active + inactive) — always editable, at any time. */
  categories: MentorCategoryRecord[];
}

interface FormState {
  fullName: string;
  position: string;
  imageUrl: string;
  bio: string;
  linkedinUrl: string;
  email: string;
  phone: string;
  city: string;
  consultationFeeStr: string;
  categoryIds: string[];
}

const empty: FormState = {
  fullName: '',
  position: '',
  imageUrl: '',
  bio: '',
  linkedinUrl: '',
  email: '',
  phone: '',
  city: '',
  consultationFeeStr: '',
  categoryIds: [],
};

function fromMentor(m: Mentor): FormState {
  return {
    fullName: m.fullName,
    position: m.position,
    imageUrl: m.imageUrl,
    bio: m.bio ?? '',
    linkedinUrl: m.linkedinUrl ?? '',
    email: m.email ?? '',
    phone: m.phone ?? '',
    city: m.city ?? '',
    consultationFeeStr: m.consultationFee ? String(m.consultationFee) : '',
    categoryIds: m.categoryIds ?? [],
  };
}

export function MentorFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  categories,
}: MentorFormDialogProps) {
  const t = useTranslations('admin.mentorFormDialog');
  const rawLocale = useLocale();
  const locale: 'en' | 'fr' | 'ar' = rawLocale === 'en' || rawLocale === 'ar' ? rawLocale : 'fr';
  const [values, setValues] = useState<FormState>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;

  // Reset on open / when the target mentor changes.
  useEffect(() => {
    if (!open) return;
    setValues(initial ? fromMentor(initial) : empty);
    setError(null);
  }, [open, initial]);

  function update<K extends keyof FormState>(key: K, val: FormState[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  // Offer active categories for new assignment, plus any inactive one this
  // mentor already carries (so it stays visible as a removable chip — an
  // admin can drop it, but can't pick OTHER inactive categories).
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((c) => c.active || values.categoryIds.includes(c.id))
        .map((c) => ({ value: c.id, label: getMentorCategoryLabel(c, locale) })),
    [categories, values.categoryIds, locale],
  );

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await mentorsService.uploadImage(file);
      update('imageUrl', res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
      // Reset the input so re-selecting the same file fires onChange.
      e.target.value = '';
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Lightweight client-side check; the server is the source of truth.
    if (values.fullName.trim().length < 2) return setError(t('errorFullNameShort'));
    if (values.position.trim().length < 2) return setError(t('errorPositionShort'));
    if (!values.imageUrl) return setError(t('errorImageRequired'));

    setSubmitting(true);
    try {
      const fee = parseInt(values.consultationFeeStr, 10);
      const payload: MentorInput = {
        fullName: values.fullName.trim(),
        position: values.position.trim(),
        imageUrl: values.imageUrl.trim(),
        bio: values.bio.trim() || null,
        linkedinUrl: values.linkedinUrl.trim() || null,
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        city: values.city.trim() || null,
        consultationFee: !isNaN(fee) && fee > 0 ? fee : 0,
        categoryIds: values.categoryIds,
      };
      const saved = isEdit
        ? await mentorsService.update(initial!.id, payload)
        : await mentorsService.create(payload);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || t('saveFailed'));
      } else {
        setError(err instanceof Error ? err.message : t('saveFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Build a preview-shaped Mentor object from the current form values.
  const fee = parseInt(values.consultationFeeStr, 10);
  const preview: Mentor = {
    id: initial?.id ?? 'preview',
    fullName: values.fullName || t('previewMentorName'),
    position: values.position || t('previewMentorPosition'),
    imageUrl: values.imageUrl || '',
    bio: values.bio.trim() || null,
    linkedinUrl: values.linkedinUrl.trim() || null,
    consultationFee: !isNaN(fee) && fee > 0 ? fee : 0,
    createdAt: initial?.createdAt ?? new Date().toISOString(),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>
            {t('dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-6 md:grid-cols-[1fr_240px]" noValidate>
          {/* Form column */}
          <div className="space-y-4">
            <Field label={t('fieldFullName')} required>
              <Input
                value={values.fullName}
                onChange={(e) => update('fullName', e.target.value)}
                placeholder={t('fullNamePlaceholder')}
                maxLength={120}
                required
              />
            </Field>

            <Field label={t('fieldPosition')} required>
              <Input
                value={values.position}
                onChange={(e) => update('position', e.target.value)}
                placeholder={t('positionPlaceholder')}
                maxLength={160}
                required
              />
            </Field>

            <Field label={t('fieldImageUrl')} required hint={t('imageUrlHint')}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={values.imageUrl}
                  onChange={(e) => update('imageUrl', e.target.value)}
                  placeholder={t('imageUrlPlaceholder')}
                  required
                />
                <label
                  className={cn(
                    'inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    uploading && 'pointer-events-none opacity-60',
                  )}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {t('upload')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                    className="sr-only"
                    onChange={onFileChange}
                  />
                </label>
              </div>
            </Field>

            <Field label={t('fieldBio')} hint={t('bioHint')}>
              <textarea
                value={values.bio}
                onChange={(e) => update('bio', e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t('bioPlaceholder')}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>

            <Field label={t('fieldLinkedin')} hint={t('linkedinHint')}>
              <div className="relative">
                <Linkedin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="url"
                  value={values.linkedinUrl}
                  onChange={(e) => update('linkedinUrl', e.target.value)}
                  placeholder={t('linkedinPlaceholder')}
                  className="ps-9"
                  maxLength={300}
                />
              </div>
            </Field>

            <Field label={t('fieldEmail')} hint={t('emailHint')}>
              <Input
                type="email"
                value={values.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder={t('emailPlaceholder')}
                maxLength={200}
              />
            </Field>

            <Field label={t('fieldPhone')} hint={t('phoneHint')}>
              <Input
                type="tel"
                value={values.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder={t('phonePlaceholder')}
                maxLength={30}
              />
            </Field>

            <Field label={t('fieldCity')} hint={t('cityHint')}>
              <Input
                type="text"
                value={values.city}
                onChange={(e) => update('city', e.target.value)}
                placeholder={t('cityPlaceholder')}
                maxLength={120}
              />
            </Field>

            <Field label={t('fieldCategories')} hint={t('categoriesHint')}>
              <MultiSelect
                options={categoryOptions}
                value={values.categoryIds}
                onChange={(next) => update('categoryIds', next)}
                placeholder={t('categoriesPlaceholder')}
                emptyLabel={t('categoriesEmpty')}
              />
            </Field>

            <Field label={t('fieldConsultationFee')} hint={t('consultationFeeHint')}>
              <Input
                type="number"
                min={0}
                max={1000000}
                step={100}
                value={values.consultationFeeStr}
                onChange={(e) => update('consultationFeeStr', e.target.value)}
                placeholder={t('consultationFeePlaceholder')}
              />
            </Field>

            {error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* Preview column */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('livePreview')}
            </p>
            {preview.imageUrl ? (
              <LandingMentorCard mentor={preview} hoverable={false} />
            ) : (
              <div className="flex aspect-square w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 text-center text-xs text-muted-foreground">
                <ImagePlus className="size-6" />
                <p className="mt-2 px-3">{t('previewImageHint')}</p>
              </div>
            )}
          </div>

          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? t('saveChanges') : t('addMentor')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
