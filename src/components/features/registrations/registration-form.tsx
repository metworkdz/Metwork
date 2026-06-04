'use client';

/**
 * RegistrationForm — public-facing multi-step registration form.
 *
 * Used on /programs/[slug] and /events/[slug] detail pages.
 * Supports both guest and authenticated registrations.
 * Renders custom fields defined by the incubator's form builder.
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, AlertCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RegistrationFormField } from '@/types/domain';

interface RegistrationFormProps {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  entityTitle: string;
  formFields: RegistrationFormField[];
  /** Pre-fill from logged-in user session. */
  prefill?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  answers: Record<string, string | string[]>;
}

type SubmitResult =
  | { type: 'confirmed' }
  | { type: 'waitlisted' }
  | { type: 'alreadyRegistered' }
  | { type: 'error'; message: string };

export function RegistrationForm({
  entityType,
  entityId,
  entityTitle,
  formFields,
  prefill,
}: RegistrationFormProps) {
  const t = useTranslations('registration');
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<FormState>({
    fullName: prefill?.fullName ?? '',
    email: prefill?.email ?? '',
    phone: prefill?.phone ?? '',
    answers: {},
  });

  function setField(key: keyof Omit<FormState, 'answers'>, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function setAnswer(fieldId: string, value: string | string[]) {
    setForm((prev) => ({
      ...prev,
      answers: { ...prev.answers, [fieldId]: value },
    }));
    setFieldErrors((prev) => ({ ...prev, [fieldId]: '' }));
  }

  function toggleCheckbox(fieldId: string, option: string) {
    const current = (form.answers[fieldId] as string[]) ?? [];
    const next = current.includes(option)
      ? current.filter((v) => v !== option)
      : [...current, option];
    setAnswer(fieldId, next);
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.fullName.trim()) errors.fullName = t('errorRequired');
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errors.email = t('errorInvalidEmail');
    if (!form.phone.trim() || form.phone.trim().length < 6)
      errors.phone = t('errorInvalidPhone');

    for (const f of formFields) {
      if (!f.required) continue;
      const val = form.answers[f.id];
      const missing = !val || (Array.isArray(val) ? val.length === 0 : !String(val).trim());
      if (missing) errors[f.id] = t('errorRequired');
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    startTransition(async () => {
      try {
        const answers = formFields.map((f) => ({
          fieldId: f.id,
          value: form.answers[f.id] ?? (
            ['CHECKBOX', 'MULTIPLE_CHOICE'].includes(f.type) ? [] : ''
          ),
        }));

        const res = await fetch('/api/registrations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType,
            entityId,
            fullName: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            phone: form.phone.trim(),
            answers,
          }),
        });

        const data = await res.json() as {
          registration?: { status: string };
          alreadyRegistered?: boolean;
          code?: string;
          message?: string;
        };

        if (!res.ok) {
          if (res.status === 429) {
            setResult({ type: 'error', message: t('errorRateLimited') });
          } else if (res.status === 409) {
            setResult({ type: 'error', message: data.message ?? t('errorDeadlinePassed') });
          } else {
            setResult({ type: 'error', message: data.message ?? t('errorGeneric') });
          }
          return;
        }

        if (data.alreadyRegistered) {
          setResult({ type: 'alreadyRegistered' });
          return;
        }

        setResult({
          type: data.registration?.status === 'WAITLISTED' ? 'waitlisted' : 'confirmed',
        });
      } catch {
        setResult({ type: 'error', message: t('errorNetwork') });
      }
    });
  }

  // ── Success states ──────────────────────────────────────────────────────
  if (result?.type === 'confirmed') {
    return (
      <div className="rounded-xl bg-green-50 p-6 text-center border border-green-200">
        <CheckCircle2 className="mx-auto size-10 text-green-600 mb-3" />
        <h3 className="text-lg font-semibold text-green-900">{t('successTitle')}</h3>
        <p className="mt-1 text-sm text-green-700">{t('successBody', { title: entityTitle })}</p>
        <p className="mt-2 text-xs text-green-600">{t('successEmail', { email: form.email })}</p>
      </div>
    );
  }

  if (result?.type === 'waitlisted') {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-center border border-amber-200">
        <Clock className="mx-auto size-10 text-amber-600 mb-3" />
        <h3 className="text-lg font-semibold text-amber-900">{t('waitlistTitle')}</h3>
        <p className="mt-1 text-sm text-amber-700">{t('waitlistBody')}</p>
      </div>
    );
  }

  if (result?.type === 'alreadyRegistered') {
    return (
      <div className="rounded-xl bg-blue-50 p-6 text-center border border-blue-200">
        <CheckCircle2 className="mx-auto size-10 text-blue-600 mb-3" />
        <h3 className="text-lg font-semibold text-blue-900">{t('alreadyTitle')}</h3>
        <p className="mt-1 text-sm text-blue-700">{t('alreadyBody')}</p>
      </div>
    );
  }

  // ── Registration form ───────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Base fields */}
      <div className="space-y-4">
        <FormField label={t('fieldFullName')} error={fieldErrors.fullName} required>
          <Input
            value={form.fullName}
            onChange={(e) => setField('fullName', e.target.value)}
            placeholder={t('placeholderFullName')}
            autoComplete="name"
          />
        </FormField>

        <FormField label={t('fieldEmail')} error={fieldErrors.email} required>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            placeholder={t('placeholderEmail')}
            autoComplete="email"
          />
        </FormField>

        <FormField label={t('fieldPhone')} error={fieldErrors.phone} required>
          <Input
            type="tel"
            value={form.phone}
            onChange={(e) => setField('phone', e.target.value)}
            placeholder={t('placeholderPhone')}
            autoComplete="tel"
          />
        </FormField>
      </div>

      {/* Custom fields */}
      {formFields.length > 0 && (
        <div className="border-t border-border/60 pt-4 space-y-4">
          {formFields.map((field) => (
            <CustomField
              key={field.id}
              field={field}
              value={form.answers[field.id]}
              error={fieldErrors[field.id]}
              onChange={(v) => setAnswer(field.id, v)}
              onToggle={(opt) => toggleCheckbox(field.id, opt)}
            />
          ))}
        </div>
      )}

      {/* Generic error */}
      {result?.type === 'error' && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {result.message}
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? (
          <><Loader2 className="size-4 animate-spin" /> {t('submitting')}</>
        ) : (
          t('submit')
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">{t('privacyNote')}</p>
    </form>
  );
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function FormField({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CustomField({
  field,
  value,
  error,
  onChange,
  onToggle,
}: {
  field: RegistrationFormField;
  value: string | string[] | undefined;
  error?: string;
  onChange: (v: string | string[]) => void;
  onToggle: (opt: string) => void;
}) {
  const stringValue = typeof value === 'string' ? value : '';
  const arrayValue = Array.isArray(value) ? value : [];

  return (
    <FormField label={field.label} error={error} required={field.required}>
      {(field.type === 'SHORT_TEXT' || field.type === 'PHONE' || field.type === 'EMAIL') && (
        <Input
          type={field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : 'text'}
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
        />
      )}

      {field.type === 'URL' && (
        <Input
          type="url"
          inputMode="url"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
        />
      )}

      {field.type === 'LONG_TEXT' && (
        <Textarea
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.label}
          rows={3}
          className="resize-none"
        />
      )}

      {field.type === 'DROPDOWN' && field.options && (
        <select
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">— Select —</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'MULTIPLE_CHOICE' && field.options && (
        <div className="space-y-2">
          {field.options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={field.id}
                value={opt}
                checked={stringValue === opt}
                onChange={() => onChange(opt)}
                className="size-4 accent-primary"
              />
              <span className="text-sm">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {field.type === 'CHECKBOX' && field.options && (
        <div className="space-y-2">
          {field.options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                value={opt}
                checked={arrayValue.includes(opt)}
                onChange={() => onToggle(opt)}
                className="size-4 accent-primary"
              />
              <span className="text-sm">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </FormField>
  );
}
