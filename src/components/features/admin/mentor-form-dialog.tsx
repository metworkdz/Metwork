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
import { useEffect, useState } from 'react';
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
import { mentorsService } from '@/services/mentors.service';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { LandingMentorCard } from '@/components/features/mentors/landing-mentor-card';
import type { Mentor, MentorInput } from '@/types/mentor';

interface MentorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the form is in "edit" mode. */
  initial?: Mentor | null;
  onSaved: (mentor: Mentor) => void;
}

interface FormState extends MentorInput {
  bio: string;
  linkedinUrl: string;
}

const empty: FormState = {
  fullName: '',
  position: '',
  imageUrl: '',
  bio: '',
  linkedinUrl: '',
};

function fromMentor(m: Mentor): FormState {
  return {
    fullName: m.fullName,
    position: m.position,
    imageUrl: m.imageUrl,
    bio: m.bio ?? '',
    linkedinUrl: m.linkedinUrl ?? '',
  };
}

export function MentorFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: MentorFormDialogProps) {
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

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await mentorsService.uploadImage(file);
      update('imageUrl', res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
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
    if (values.fullName.trim().length < 2) return setError('Full name is too short.');
    if (values.position.trim().length < 2) return setError('Position is too short.');
    if (!values.imageUrl) return setError('An image URL is required.');

    setSubmitting(true);
    try {
      const payload: MentorInput = {
        fullName: values.fullName.trim(),
        position: values.position.trim(),
        imageUrl: values.imageUrl.trim(),
        bio: values.bio.trim() || null,
        linkedinUrl: values.linkedinUrl.trim() || null,
      };
      const saved = isEdit
        ? await mentorsService.update(initial!.id, payload)
        : await mentorsService.create(payload);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Save failed.');
      } else {
        setError(err instanceof Error ? err.message : 'Save failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Build a preview-shaped Mentor object from the current form values.
  const preview: Mentor = {
    id: initial?.id ?? 'preview',
    fullName: values.fullName || 'Mentor name',
    position: values.position || 'Position · Company',
    imageUrl: values.imageUrl || '',
    bio: values.bio.trim() || null,
    linkedinUrl: values.linkedinUrl.trim() || null,
    createdAt: initial?.createdAt ?? new Date().toISOString(),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit mentor' : 'Add a new mentor'}</DialogTitle>
          <DialogDescription>
            Fields marked with an asterisk are required. The right-hand preview is
            exactly how this mentor will appear on the landing page.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-6 md:grid-cols-[1fr_240px]" noValidate>
          {/* Form column */}
          <div className="space-y-4">
            <Field label="Full name" required>
              <Input
                value={values.fullName}
                onChange={(e) => update('fullName', e.target.value)}
                placeholder="e.g. Amina Hamdi"
                maxLength={120}
                required
              />
            </Field>

            <Field label="Position" required>
              <Input
                value={values.position}
                onChange={(e) => update('position', e.target.value)}
                placeholder="e.g. Operating Partner — Maghreb Ventures"
                maxLength={160}
                required
              />
            </Field>

            <Field label="Image URL" required hint="Paste an HTTPS URL or upload a file below.">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={values.imageUrl}
                  onChange={(e) => update('imageUrl', e.target.value)}
                  placeholder="https://… or /uploads/mentors/…"
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
                  Upload
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                    className="sr-only"
                    onChange={onFileChange}
                  />
                </label>
              </div>
            </Field>

            <Field label="Bio" hint="Optional. Up to 2,000 characters.">
              <textarea
                value={values.bio}
                onChange={(e) => update('bio', e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="One paragraph on what they're good at."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>

            <Field label="LinkedIn URL" hint="Optional. Shown as an icon link on the card.">
              <div className="relative">
                <Linkedin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="url"
                  value={values.linkedinUrl}
                  onChange={(e) => update('linkedinUrl', e.target.value)}
                  placeholder="https://www.linkedin.com/in/…"
                  className="ps-9"
                  maxLength={300}
                />
              </div>
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
              Live preview
            </p>
            {preview.imageUrl ? (
              <LandingMentorCard mentor={preview} hoverable={false} />
            ) : (
              <div className="flex aspect-square w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 text-center text-xs text-muted-foreground">
                <ImagePlus className="size-6" />
                <p className="mt-2 px-3">Add an image URL or upload a file to see the preview.</p>
              </div>
            )}
          </div>

          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? 'Save changes' : 'Add mentor'}
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
