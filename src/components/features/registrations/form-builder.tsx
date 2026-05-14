'use client';

/**
 * RegistrationFormBuilder — incubator dashboard component.
 *
 * Lets incubators design a custom registration form for a program or event.
 * Fields are saved as a batch (POST /api/incubator/registration-form).
 *
 * Features:
 *  - Add / remove / reorder fields
 *  - All 7 field types: SHORT_TEXT, LONG_TEXT, DROPDOWN, MULTIPLE_CHOICE,
 *    CHECKBOX, PHONE, EMAIL
 *  - Options editor for choice-type fields
 *  - Required / optional toggle
 *  - Live preview of the field label
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  Plus,
  Trash2,
  GripVertical,
  Save,
  Loader2,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { RegistrationFieldType, RegistrationFormField } from '@/types/domain';

const FIELD_TYPE_OPTIONS: { value: RegistrationFieldType; labelKey: string }[] = [
  { value: 'SHORT_TEXT',      labelKey: 'typeShortText' },
  { value: 'LONG_TEXT',       labelKey: 'typeLongText' },
  { value: 'EMAIL',           labelKey: 'typeEmail' },
  { value: 'PHONE',           labelKey: 'typePhone' },
  { value: 'DROPDOWN',        labelKey: 'typeDropdown' },
  { value: 'MULTIPLE_CHOICE', labelKey: 'typeMultipleChoice' },
  { value: 'CHECKBOX',        labelKey: 'typeCheckbox' },
];

const CHOICE_TYPES: RegistrationFieldType[] = ['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'];

interface BuilderField {
  /** Temp UI-only id for React keys. Not sent to server. */
  _key: string;
  label: string;
  type: RegistrationFieldType;
  options: string[];
  required: boolean;
}

interface RegistrationFormBuilderProps {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  /** Initial fields loaded from the API. */
  initialFields: RegistrationFormField[];
}

let _key = 0;
function newKey() { return `field-${++_key}`; }

function toBuilderField(f: RegistrationFormField): BuilderField {
  return {
    _key: newKey(),
    label: f.label,
    type: f.type,
    options: f.options ?? [],
    required: f.required,
  };
}

function emptyField(): BuilderField {
  return { _key: newKey(), label: '', type: 'SHORT_TEXT', options: [], required: false };
}

export function RegistrationFormBuilder({
  entityType,
  entityId,
  initialFields,
}: RegistrationFormBuilderProps) {
  const t = useTranslations('formBuilder');
  const [fields, setFields] = useState<BuilderField[]>(initialFields.map(toBuilderField));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  /* ── Field mutations ──────────────────────────────────────────────── */
  function addField() {
    setFields((prev) => [...prev, emptyField()]);
    setSaved(false);
  }

  function removeField(key: string) {
    setFields((prev) => prev.filter((f) => f._key !== key));
    setSaved(false);
  }

  function moveField(key: string, direction: 'up' | 'down') {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f._key === key);
      if (idx === -1) return prev;
      const next = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      return next;
    });
    setSaved(false);
  }

  function updateField(key: string, patch: Partial<BuilderField>) {
    setFields((prev) =>
      prev.map((f) => (f._key === key ? { ...f, ...patch } : f)),
    );
    setSaved(false);
  }

  function addOption(key: string) {
    setFields((prev) =>
      prev.map((f) =>
        f._key === key ? { ...f, options: [...f.options, ''] } : f,
      ),
    );
  }

  function updateOption(key: string, optIdx: number, value: string) {
    setFields((prev) =>
      prev.map((f) =>
        f._key === key
          ? {
              ...f,
              options: f.options.map((o, i) => (i === optIdx ? value : o)),
            }
          : f,
      ),
    );
    setSaved(false);
  }

  function removeOption(key: string, optIdx: number) {
    setFields((prev) =>
      prev.map((f) =>
        f._key === key
          ? { ...f, options: f.options.filter((_, i) => i !== optIdx) }
          : f,
      ),
    );
    setSaved(false);
  }

  /* ── Validation ──────────────────────────────────────────────────── */
  function validate(): string | null {
    for (const f of fields) {
      if (!f.label.trim()) return t('validationLabelRequired');
      if (CHOICE_TYPES.includes(f.type) && f.options.filter((o) => o.trim()).length < 1) {
        return t('validationOptionsRequired', { label: f.label });
      }
    }
    return null;
  }

  /* ── Save ─────────────────────────────────────────────────────────── */
  function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');

    startTransition(async () => {
      try {
        const res = await fetch('/api/incubator/registration-form', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType,
            entityId,
            fields: fields.map((f, i) => ({
              label: f.label.trim(),
              type: f.type,
              options: CHOICE_TYPES.includes(f.type)
                ? f.options.filter((o) => o.trim())
                : null,
              required: f.required,
              order: i,
            })),
          }),
        });
        if (!res.ok) {
          const data = await res.json() as { message?: string };
          setError(data.message ?? t('saveError'));
          return;
        }
        setSaved(true);
      } catch {
        setError(t('saveNetworkError'));
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t('title')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('subtitle')}</p>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="size-3.5 text-green-500" />
          ) : (
            <Save className="size-3.5" />
          )}
          {saved ? t('saved') : t('save')}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      {/* Fields list */}
      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('noFields')}</p>
        </div>
      )}

      <div className="space-y-3">
        {fields.map((field, idx) => (
          <FieldEditor
            key={field._key}
            field={field}
            index={idx}
            total={fields.length}
            onUpdate={(patch) => updateField(field._key, patch)}
            onRemove={() => removeField(field._key)}
            onMove={(dir) => moveField(field._key, dir)}
            onAddOption={() => addOption(field._key)}
            onUpdateOption={(oi, v) => updateOption(field._key, oi, v)}
            onRemoveOption={(oi) => removeOption(field._key, oi)}
          />
        ))}
      </div>

      {/* Add field button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5 border-dashed"
        onClick={addField}
      >
        <Plus className="size-4" /> {t('addField')}
      </Button>
    </div>
  );
}

/* ─────────────────────────── FieldEditor ─────────────────────────── */

function FieldEditor({
  field,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}: {
  field: BuilderField;
  index: number;
  total: number;
  onUpdate: (p: Partial<BuilderField>) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onAddOption: () => void;
  onUpdateOption: (idx: number, val: string) => void;
  onRemoveOption: (idx: number) => void;
}) {
  const t = useTranslations('formBuilder');
  const isChoiceType = CHOICE_TYPES.includes(field.type);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Row 1: drag handle + label + type + required + delete */}
      <div className="flex items-start gap-2">
        {/* Reorder */}
        <div className="flex flex-col gap-0.5 pt-1 shrink-0">
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={index === 0}
            className="text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
            aria-label="Move up"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={index === total - 1}
            className="text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
            aria-label="Move down"
          >
            <ChevronDown className="size-4" />
          </button>
          <GripVertical className="size-4 text-muted-foreground/30 mt-0.5" />
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">{t('fieldLabel')}</Label>
          <Input
            value={field.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder={t('fieldLabelPlaceholder')}
            className="h-8 text-sm"
          />
        </div>

        {/* Type */}
        <div className="w-44 shrink-0 space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">{t('fieldType')}</Label>
          <select
            value={field.type}
            onChange={(e) => onUpdate({ type: e.target.value as RegistrationFieldType, options: [] })}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FIELD_TYPE_OPTIONS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t(labelKey)}</option>
            ))}
          </select>
        </div>

        {/* Required toggle */}
        <div className="pt-6 shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => onUpdate({ required: e.target.checked })}
              className="size-4 accent-primary rounded"
            />
            <span className="text-xs text-muted-foreground">{t('required')}</span>
          </label>
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={onRemove}
          className="mt-6 shrink-0 text-muted-foreground/50 hover:text-destructive transition-colors"
          aria-label="Delete field"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* Options editor for DROPDOWN / MULTIPLE_CHOICE / CHECKBOX */}
      {isChoiceType && (
        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              {t('options')}
            </Label>
            <Badge variant="outline" className="text-[10px]">{t('optionsHint')}</Badge>
          </div>
          <div className="space-y-1.5">
            {field.options.map((opt, oi) => (
              <div key={oi} className="flex gap-1.5">
                <Input
                  value={opt}
                  onChange={(e) => onUpdateOption(oi, e.target.value)}
                  placeholder={`${t('option')} ${oi + 1}`}
                  className="h-8 text-sm"
                />
                <button
                  type="button"
                  onClick={() => onRemoveOption(oi)}
                  className="shrink-0 text-muted-foreground/50 hover:text-destructive"
                  aria-label="Remove option"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onAddOption}
          >
            <Plus className="size-3" /> {t('addOption')}
          </Button>
        </div>
      )}
    </div>
  );
}
