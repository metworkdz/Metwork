'use client';

/**
 * RegistrationFormBuilder — incubator dashboard component.
 *
 * Lets incubators design a custom registration form for a program or event.
 * Fields are saved as a batch. Which endpoint receives them depends on who is
 * editing — the incubator dashboard or the consultant portal — so the caller
 * passes it in; the builder itself is identical on both surfaces.
 *
 * Features:
 *  - Add / remove / reorder fields
 *  - Field types: SHORT_TEXT, LONG_TEXT, DROPDOWN, MULTIPLE_CHOICE,
 *    CHECKBOX, PHONE, EMAIL, URL, and FILE (one private PDF/JPG upload)
 *  - Options editor for choice-type fields
 *  - Required / optional toggle
 *  - Live preview of the field label
 */
import { useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Plus,
  Trash2,
  GripVertical,
  Save,
  Loader2,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  ListPlus,
  Pencil,
  Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { buildDefaultApplicationFields } from '@/server/programs/default-application-questions';
import { keysSurvivingEdit } from '@/lib/registration-question';
import { MAX_REGISTRATION_FILE_MB } from '@/lib/upload-limits';
import {
  MAX_FORM_FIELDS,
  MAX_OPTION_LENGTH,
  cleanOptions,
  findDuplicateOption,
  insertPastedOptions,
} from '@/lib/registration-options';
import {
  dropDraftedTranslations,
  type FieldTranslations,
} from '@/lib/registration-translations';
import { locales, type Locale } from '@/i18n/config';
import {
  TranslateBar,
  TranslationsEditor,
  sourceChoiceCount,
} from './form-builder-translations';
import { cn } from '@/lib/utils';
import type { RegistrationFieldType, RegistrationFormField } from '@/types/domain';

const FIELD_TYPE_OPTIONS: { value: RegistrationFieldType; labelKey: string }[] = [
  { value: 'SHORT_TEXT',      labelKey: 'typeShortText' },
  { value: 'LONG_TEXT',       labelKey: 'typeLongText' },
  { value: 'EMAIL',           labelKey: 'typeEmail' },
  { value: 'PHONE',           labelKey: 'typePhone' },
  { value: 'URL',             labelKey: 'typeUrl' },
  { value: 'DROPDOWN',        labelKey: 'typeDropdown' },
  { value: 'MULTIPLE_CHOICE', labelKey: 'typeMultipleChoice' },
  { value: 'CHECKBOX',        labelKey: 'typeCheckbox' },
  { value: 'FILE',            labelKey: 'typeFile' },
];

const CHOICE_TYPES: RegistrationFieldType[] = ['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'];

interface BuilderField {
  /** Temp UI-only id for React keys. Not sent to server. */
  _key: string;
  /**
   * The saved question's id, when it has been saved. Sent back so a save KEEPS
   * the question — and with it every answer already collected — instead of
   * replacing it with a new one. Null for a row added since the last save.
   */
  id: string | null;
  label: string;
  type: RegistrationFieldType;
  options: string[];
  required: boolean;
  /**
   * The seeded question this row came from, if any — kept so the PUBLIC form
   * can render it in the VISITOR's locale rather than the author's. Carried
   * through untouched, and dropped on save the moment the wording is edited
   * (`keysSurvivingEdit`): the host's own words must never be overwritten by
   * the template's translation.
   */
  labelKey: string | null;
  optionKeys: string[] | null;
  /**
   * The wording this row was loaded/seeded with, kept as the baseline the save
   * path compares against. Editing the label away from it drops the key;
   * editing back to it restores the key, which is what a host who changes
   * their mind expects.
   */
  _seed: { label: string; options: string[] } | null;
  /**
   * "Ask only if" rule: the controlling row's `_key` (not its position, which
   * moves as rows are reordered) and the option that unlocks this question.
   * Turned back into a position on save.
   */
  showWhen: { key: string; equals: string } | null;
  /**
   * The wording and choices in other languages, for DISPLAY — answers are always
   * recorded as the source option. See `@/lib/registration-translations`.
   */
  translations: FieldTranslations;
  /** Languages in `translations` that are machine drafts nobody has read yet. */
  drafted: Locale[];
  /** Bumped when translations change from outside their editor, so it re-reads them. */
  rev: number;
}

/**
 * A question whose source wording was just edited: its machine drafts described
 * the OLD wording, so they are dropped (and can be redrafted). Translations a
 * person wrote or checked are kept.
 */
function withStaleDraftsDropped(f: BuilderField): BuilderField {
  if (f.drafted.length === 0) return f;
  const d = dropDraftedTranslations(f.translations, f.drafted);
  return { ...f, translations: d.translations ?? {}, drafted: [], rev: f.rev + 1 };
}

/** Is this row still the seeded question, whose wording localizes by itself? */
function isSeededUnedited(f: BuilderField): boolean {
  return !!f.labelKey && !!f._seed && f.label.trim() === f._seed.label;
}

/** An earlier choice question another row may depend on. */
interface ChoiceRef { key: string; label: string; options: string[] }

interface RegistrationFormBuilderProps {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  /** Initial fields loaded from the API. */
  initialFields: RegistrationFormField[];
  /** Which surface owns this listing. Defaults to the incubator dashboard. */
  endpoint?: '/api/incubator/registration-form' | '/api/consultant/registration-form';
}

let _key = 0;
function newKey() { return `field-${++_key}`; }

function toBuilderField(f: RegistrationFormField): BuilderField {
  return {
    _key: newKey(),
    id: f.id,
    label: f.label,
    type: f.type,
    options: f.options ?? [],
    required: f.required,
    labelKey: f.labelKey ?? null,
    optionKeys: f.optionKeys ?? null,
    _seed: f.labelKey ? { label: f.label, options: f.options ?? [] } : null,
    showWhen: null,
    translations: f.translations ?? {},
    drafted: f.draftedLocales ?? [],
    rev: 0,
  };
}

/** Load the stored rules, re-pointing each from a position to the row's key. */
function toBuilderFields(initial: RegistrationFormField[]): BuilderField[] {
  const rows = initial.map(toBuilderField);
  return rows.map((row, i) => {
    const rule = initial[i]?.showWhen;
    const controller = rule ? rows[rule.order] : undefined;
    return rule && controller && rule.order < i
      ? { ...row, showWhen: { key: controller._key, equals: rule.equals } }
      : row;
  });
}

/** A question the host wrote themselves — never template-translated. */
function emptyField(): BuilderField {
  return {
    _key: newKey(), id: null, label: '', type: 'SHORT_TEXT', options: [], required: false,
    labelKey: null, optionKeys: null, _seed: null, showWhen: null,
    translations: {}, drafted: [], rev: 0,
  };
}

export function RegistrationFormBuilder({
  entityType,
  entityId,
  initialFields,
  endpoint = '/api/incubator/registration-form',
}: RegistrationFormBuilderProps) {
  const t = useTranslations('formBuilder');
  const tQuestions = useTranslations('defaultQuestions');
  const [fields, setFields] = useState<BuilderField[]>(() => toBuilderFields(initialFields));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const uiLocale = useLocale() as Locale;
  /** The language the host's own wording is in — the fallback for every visitor. */
  const [sourceLocale, setSourceLocale] = useState<Locale>(
    () => initialFields.find((f) => f.sourceLocale)?.sourceLocale ?? uiLocale,
  );
  const [translating, setTranslating] = useState(false);
  const [translateNote, setTranslateNote] = useState('');
  const [translateError, setTranslateError] = useState('');

  /* ── Field mutations ──────────────────────────────────────────────── */
  function addField() {
    setFields((prev) => [...prev, emptyField()]);
    setSaved(false);
  }

  // Append the localized default question set. Additive (never clears existing
  // work) and unsaved until the incubator clicks Save.
  function insertDefaultQuestions() {
    const defaults = buildDefaultApplicationFields((k) => tQuestions(k)).map<BuilderField>((f) => ({
      _key: newKey(),
      id: null,
      label: f.label,
      type: f.type,
      options: f.options ?? [],
      required: f.required,
      labelKey: f.labelKey,
      optionKeys: f.optionKeys,
      _seed: { label: f.label, options: f.options ?? [] },
      showWhen: null,
      translations: {},
      drafted: [],
      rev: 0,
    }));
    setFields((prev) => [...prev, ...defaults]);
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
    // Editing the wording (or type) invalidates machine drafts of the old wording.
    const changesWording = 'label' in patch || 'type' in patch;
    setFields((prev) =>
      prev.map((f) => {
        if (f._key !== key) return f;
        const next = { ...f, ...patch };
        return changesWording ? withStaleDraftsDropped(next) : next;
      }),
    );
    setSaved(false);
  }

  /** Switching the source language: a translation INTO the new source would shadow the host's own words. */
  function changeSourceLocale(next: Locale) {
    setSourceLocale(next);
    setFields((prev) =>
      prev.map((f) => {
        if (!f.translations[next]) return f;
        const { [next]: _gone, ...rest } = f.translations;
        return { ...f, translations: rest, drafted: f.drafted.filter((d) => d !== next), rev: f.rev + 1 };
      }),
    );
    setSaved(false);
  }

  /**
   * Draft the missing languages of every host-written question with Claude. It
   * fills only what is empty, marks it as a draft, and stores nothing until the
   * host has read it and pressed Save.
   */
  async function translateAll() {
    setTranslateNote('');
    setTranslateError('');
    const rows = fields
      .map((f, index) => ({ f, index }))
      .filter(({ f }) => f.label.trim() && !isSeededUnedited(f));
    const wanted = rows
      .map(({ f, index }) => {
        const isChoice = CHOICE_TYPES.includes(f.type);
        const need = sourceChoiceCount(f);
        const targets = locales.filter(
          (l) =>
            l !== sourceLocale &&
            (!(f.translations[l]?.label ?? '').trim() ||
              (isChoice && (f.translations[l]?.options?.length ?? 0) !== need)),
        );
        return { index, targets, label: f.label.trim(), options: isChoice ? cleanOptions(f.options) : null };
      })
      .filter((w) => w.targets.length > 0);
    if (wanted.length === 0) { setTranslateNote(t('translateNothing')); return; }

    setTranslating(true);
    try {
      const res = await fetch(`${endpoint}/translate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceLocale,
          fields: wanted.map(({ label, options, targets }) => ({ label, options, targets })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { code?: string } };
        setTranslateError(
          res.status === 429 ? t('translateRateLimited')
          : data.error?.code === 'TRANSLATION_UNAVAILABLE' ? t('translateUnavailable')
          : t('translateFailed'),
        );
        return;
      }
      const data = await res.json() as { fields: FieldTranslations[] };
      let count = 0;
      setFields((prev) =>
        prev.map((f, index) => {
          const at = wanted.findIndex((w) => w.index === index);
          const drafts = at >= 0 ? data.fields[at] : undefined;
          if (!drafts) return f;
          const translations: FieldTranslations = { ...f.translations };
          const drafted = new Set(f.drafted);
          for (const l of wanted[at]!.targets) {
            const got = drafts[l];
            if (!got) continue;
            const have = translations[l] ?? {};
            const next = { ...have };
            // Fill only what is empty: a person's own wording is never overwritten.
            if (got.label && !(have.label ?? '').trim()) next.label = got.label;
            if (got.options && (have.options?.length ?? 0) !== sourceChoiceCount(f)) next.options = got.options;
            if (next.label !== have.label || next.options !== have.options) {
              translations[l] = next;
              drafted.add(l);
              count += 1;
            }
          }
          return count === 0 ? f : { ...f, translations, drafted: locales.filter((l) => drafted.has(l)), rev: f.rev + 1 };
        }),
      );
      setTranslateNote(count > 0 ? t('translateDone', { count }) : t('translateNothingBack'));
      if (count > 0) setSaved(false);
    } catch {
      setTranslateError(t('translateFailed'));
    } finally {
      setTranslating(false);
    }
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
          ? withStaleDraftsDropped({
              ...f,
              options: f.options.map((o, i) => (i === optIdx ? value : o)),
            })
          : f,
      ),
    );
    setSaved(false);
  }

  /** A pasted list becomes one choice per line (see insertPastedOptions). */
  function pasteOptions(key: string, optIdx: number, text: string) {
    setFields((prev) =>
      prev.map((f) =>
        f._key === key
          ? withStaleDraftsDropped({ ...f, options: insertPastedOptions(f.options, optIdx, text).options })
          : f,
      ),
    );
    setSaved(false);
  }

  function removeOption(key: string, optIdx: number) {
    setFields((prev) =>
      prev.map((f) =>
        f._key === key
          ? withStaleDraftsDropped({ ...f, options: f.options.filter((_, i) => i !== optIdx) })
          : f,
      ),
    );
    setSaved(false);
  }

  /* ── Validation ──────────────────────────────────────────────────── */
  function validate(): string | null {
    if (fields.length > MAX_FORM_FIELDS) return t('validationTooManyFields', { max: MAX_FORM_FIELDS });
    for (const f of fields) {
      if (!f.label.trim()) return t('validationLabelRequired');
      if (CHOICE_TYPES.includes(f.type)) {
        if (cleanOptions(f.options).length < 1) return t('validationOptionsRequired', { label: f.label });
        const dup = findDuplicateOption(f.options);
        if (dup) return t('validationOptionsDuplicate', { label: f.label, option: dup });
        // A language's choices must line up one-for-one with the source choices,
        // or the wrong words would be shown for an option.
        const expected = cleanOptions(f.options).length;
        for (const l of locales) {
          const got = f.translations[l]?.options?.length ?? 0;
          if (got > 0 && got !== expected) {
            return t('validationTranslationMismatch', { label: f.label, language: l.toUpperCase(), expected, got });
          }
        }
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
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType,
            entityId,
            fields: fields.map((f, i) => {
              const options = CHOICE_TYPES.includes(f.type)
                ? cleanOptions(f.options)
                : null;
              // An edited question stops being the template's — see
              // keysSurvivingEdit for why the key has to go with the wording.
              const { labelKey, optionKeys } = keysSurvivingEdit(
                f._seed
                  ? { label: f._seed.label, labelKey: f.labelKey, options: f._seed.options, optionKeys: f.optionKeys }
                  : undefined,
                { label: f.label.trim(), options: options ?? [] },
              );
              return {
                ...(f.id ? { id: f.id } : {}),
                label: f.label.trim(),
                labelKey,
                type: f.type,
                options,
                optionKeys,
                required: f.required,
                order: i,
                // Position of the controlling row now; dropped if it was
                // deleted or moved below this one (it must stay earlier).
                sourceLocale,
                // A seeded question localizes by its key; translations only apply to host-written ones.
                translations: labelKey ? null : f.translations,
                draftedLocales: labelKey ? null : f.drafted,
                showWhen: (() => {
                  if (!f.showWhen) return null;
                  const at = fields.findIndex((c) => c._key === f.showWhen!.key);
                  return at >= 0 && at < i ? { order: at, equals: f.showWhen.equals } : null;
                })(),
              };
            }),
          }),
        });
        if (!res.ok) {
          // The API's errors are { error: { code, message } }; reading the top
          // level (as this used to) showed "Failed to save" for every refusal,
          // however specific the reason.
          const data = await res.json().catch(() => ({})) as { error?: { message?: string }; message?: string };
          setError(data.error?.message ?? data.message ?? t('saveError'));
          return;
        }
        // Remember the ids the server just gave the new rows. Without this a
        // second save would send them as new again and replace them, detaching
        // any answers that arrived in between.
        const saved = await res.json().catch(() => null) as { fields?: Array<{ id: string }> } | null;
        const ids = saved?.fields;
        if (ids && ids.length === fields.length) {
          setFields((prev) => prev.map((f, i) => ({ ...f, id: ids[i]!.id })));
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

      {fields.some((f) => !isSeededUnedited(f)) && (
        <TranslateBar
          sourceLocale={sourceLocale}
          onSourceChange={changeSourceLocale}
          onTranslate={() => void translateAll()}
          busy={translating}
          note={translateNote}
          error={translateError}
        />
      )}

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
        {fields.map((field, idx) => {
          const handlers = {
            onUpdate: (patch: Partial<BuilderField>) => updateField(field._key, patch),
            onRemove: () => removeField(field._key),
            onMove: (dir: 'up' | 'down') => moveField(field._key, dir),
            onAddOption: () => addOption(field._key),
            onUpdateOption: (oi: number, v: string) => updateOption(field._key, oi, v),
            onPasteOptions: (oi: number, text: string) => pasteOptions(field._key, oi, text),
            onRemoveOption: (oi: number) => removeOption(field._key, oi),
          };
          // Earlier choice questions this one may depend on.
          const earlier: ChoiceRef[] = fields
            .slice(0, idx)
            .filter((c) => CHOICE_TYPES.includes(c.type) && c.options.some((o) => o.trim()))
            .map((c) => ({ key: c._key, label: c.label, options: c.options.filter((o) => o.trim()) }));
          return (
            <div key={field._key}>
              {/* Desktop: inline editor (unchanged) */}
              <div className="hidden lg:block">
                <FieldEditor field={field} index={idx} total={fields.length} earlier={earlier} sourceLocale={sourceLocale} {...handlers} />
              </div>
              {/* Mobile: compact card + bottom-sheet editor */}
              <MobileFieldCard
                className="lg:hidden"
                field={field}
                index={idx}
                total={fields.length}
                earlier={earlier}
                sourceLocale={sourceLocale}
                {...handlers}
              />
            </div>
          );
        })}
      </div>

      {fields.length >= MAX_FORM_FIELDS && (
        <p className="text-center text-xs text-muted-foreground">
          {t('fieldLimitReached', { max: MAX_FORM_FIELDS })}
        </p>
      )}

      {/* Add-field actions */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          className="hidden w-full gap-1.5 border-dashed lg:flex"
          onClick={addField}
          disabled={fields.length >= MAX_FORM_FIELDS}
        >
          <Plus className="size-4" /> {t('addField')}
        </Button>
        {entityType === 'PROGRAM' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-muted-foreground hover:text-foreground sm:w-auto sm:shrink-0"
            onClick={insertDefaultQuestions}
          >
            <ListPlus className="size-4" /> {t('insertDefaults')}
          </Button>
        )}
      </div>

      {/* Mobile: sticky bottom action bar */}
      <div className="sticky bottom-0 -mx-3 flex gap-2 border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <Button
          variant="outline"
          className="h-11 flex-1 gap-1.5"
          onClick={addField}
          disabled={fields.length >= MAX_FORM_FIELDS}
        >
          <Plus className="size-4" /> {t('addField')}
        </Button>
        <Button
          className="h-11 flex-1 gap-1.5"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {saved ? t('saved') : t('save')}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── FieldEditor ─────────────────────────── */

function FieldEditor({
  field,
  index,
  total,
  earlier,
  sourceLocale,
  onUpdate,
  onRemove,
  onMove,
  onAddOption,
  onUpdateOption,
  onPasteOptions,
  onRemoveOption,
}: {
  field: BuilderField;
  index: number;
  total: number;
  earlier: ChoiceRef[];
  sourceLocale: Locale;
  onUpdate: (p: Partial<BuilderField>) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onAddOption: () => void;
  onUpdateOption: (idx: number, val: string) => void;
  onPasteOptions: (idx: number, text: string) => void;
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
            maxLength={MAX_OPTION_LENGTH}
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

      <ShowWhenSelect field={field} earlier={earlier} onUpdate={onUpdate} />

      {field.type === 'FILE' && <FileFieldNote />}

      {/* Options editor for DROPDOWN / MULTIPLE_CHOICE / CHECKBOX */}
      {isChoiceType && (
        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              {t('options')} <span className="tabular-nums">({field.options.length})</span>
            </Label>
            <Badge variant="outline" className="text-[10px]">{t('optionsHint')}</Badge>
          </div>
          {/* A long list (the 58 wilayas) scrolls inside its own box instead of
              making the whole form thousands of pixels tall. */}
          <div className="max-h-80 space-y-1.5 overflow-y-auto pe-1">
            {field.options.map((opt, oi) => (
              <div key={oi} className="flex gap-1.5">
                <Input
                  value={opt}
                  onChange={(e) => onUpdateOption(oi, e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    if (/[\r\n]/.test(text.trim())) { e.preventDefault(); onPasteOptions(oi, text); }
                  }}
                  maxLength={MAX_OPTION_LENGTH}
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

      {!(field.labelKey && field._seed && field.label.trim() === field._seed.label) && field.label.trim() !== '' && (
        <TranslationsEditor
          row={field}
          sourceLocale={sourceLocale}
          onChange={(patch) => onUpdate(patch)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── FileFieldNote ───────────────────────────
 * A FILE question has nothing to configure: it always takes one PDF or JPG up to
 * the platform limit, kept private to the listing's owner. The note says so, so
 * the host knows what applicants will be offered and who can open the result. */
function FileFieldNote() {
  const t = useTranslations('formBuilder');
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Paperclip className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {t('fileHint', { max: MAX_REGISTRATION_FILE_MB })}
    </p>
  );
}

/* ─────────────────────────── ShowWhenSelect ───────────────────────────
 * "Always ask" or "only ask if <earlier question> = <option>". Hidden on the
 * first question and whenever no earlier choice question exists to depend on. */

function ShowWhenSelect({
  field,
  earlier,
  onUpdate,
  tall,
}: {
  field: BuilderField;
  earlier: ChoiceRef[];
  onUpdate: (p: Partial<BuilderField>) => void;
  tall?: boolean;
}) {
  const t = useTranslations('formBuilder');
  if (earlier.length === 0) return null;

  // "<key>|<option>" — the key never contains a pipe, so split on the first.
  const value = field.showWhen ? `${field.showWhen.key}|${field.showWhen.equals}` : '';
  const known = earlier.some((c) => c.key === field.showWhen?.key && c.options.includes(field.showWhen.equals));

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{t('showWhenLabel')}</Label>
      <select
        value={known ? value : ''}
        onChange={(e) => {
          const v = e.target.value;
          const at = v.indexOf('|');
          onUpdate({ showWhen: v ? { key: v.slice(0, at), equals: v.slice(at + 1) } : null });
        }}
        className={cn(
          'flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          tall ? 'h-11' : 'h-8',
        )}
      >
        <option value="">{t('showWhenAlways')}</option>
        {earlier.flatMap((c) =>
          c.options.map((o) => (
            <option key={`${c.key}|${o}`} value={`${c.key}|${o}`}>
              {t('showWhenIf', { question: c.label.trim() || t('untitledField'), option: o })}
            </option>
          )),
        )}
      </select>
    </div>
  );
}

/* ────────────────────────── MobileFieldCard ──────────────────────────
 * Touch-first variant shown only below `lg`. The summary card exposes large
 * (44px) tap targets; editing happens in a bottom sheet so inputs are
 * full-width. Reuses the exact same handlers as the desktop FieldEditor — no
 * separate logic. Desktop is rendered by FieldEditor and unaffected. */
function MobileFieldCard({
  className,
  field,
  index,
  total,
  earlier,
  sourceLocale,
  onUpdate,
  onRemove,
  onMove,
  onAddOption,
  onUpdateOption,
  onPasteOptions,
  onRemoveOption,
}: {
  className?: string;
  field: BuilderField;
  index: number;
  total: number;
  earlier: ChoiceRef[];
  sourceLocale: Locale;
  onUpdate: (p: Partial<BuilderField>) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onAddOption: () => void;
  onUpdateOption: (idx: number, val: string) => void;
  onPasteOptions: (idx: number, text: string) => void;
  onRemoveOption: (idx: number) => void;
}) {
  const t = useTranslations('formBuilder');
  const [open, setOpen] = useState(false);
  const snapshot = useRef<BuilderField | null>(null);
  const isChoiceType = CHOICE_TYPES.includes(field.type);
  const typeOption = FIELD_TYPE_OPTIONS.find((o) => o.value === field.type);

  function handleOpenChange(next: boolean) {
    // Snapshot on open so Cancel can revert the in-memory edits.
    if (next) snapshot.current = { ...field, options: [...field.options] };
    setOpen(next);
  }

  function handleCancel() {
    const snap = snapshot.current;
    if (snap) {
      onUpdate({
        label: snap.label,
        type: snap.type,
        options: snap.options,
        required: snap.required,
        showWhen: snap.showWhen,
        translations: snap.translations,
        drafted: snap.drafted,
        rev: snap.rev + 1,
      });
    }
    setOpen(false);
  }

  const iconBtn =
    'flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div className={className}>
      <div className="rounded-lg border border-border bg-card p-3">
        {/* Summary */}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {field.label.trim() || t('untitledField')}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {typeOption ? t(typeOption.labelKey) : field.type}
            </Badge>
            {field.required && (
              <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                {t('required')}
              </Badge>
            )}
          </div>
        </div>

        {/* Actions — 44px tap targets */}
        <div className="mt-2.5 flex items-center gap-1 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => handleOpenChange(true)}
            className={iconBtn}
            aria-label="Edit field"
          >
            <Pencil className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={index === 0}
            className={iconBtn}
            aria-label="Move up"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={index === total - 1}
            className={iconBtn}
            aria-label="Move down"
          >
            <ChevronDown className="size-5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="ms-auto flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete field"
          >
            <Trash2 className="size-5" />
          </button>
        </div>
      </div>

      {/* Bottom-sheet editor */}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] gap-0 overflow-hidden rounded-t-2xl p-0"
        >
          <div className="flex max-h-[90vh] flex-col">
            {/* Header */}
            <div className="border-b border-border px-4 py-3">
              <h4 className="text-sm font-semibold">{t('editField')}</h4>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{t('fieldLabel')}</Label>
                <Input
                  value={field.label}
                  onChange={(e) => onUpdate({ label: e.target.value })}
                  maxLength={MAX_OPTION_LENGTH}
                  placeholder={t('fieldLabelPlaceholder')}
                  className="h-11 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{t('fieldType')}</Label>
                <select
                  value={field.type}
                  onChange={(e) => onUpdate({ type: e.target.value as RegistrationFieldType, options: [] })}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {FIELD_TYPE_OPTIONS.map(({ value, labelKey }) => (
                    <option key={value} value={value}>{t(labelKey)}</option>
                  ))}
                </select>
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => onUpdate({ required: e.target.checked })}
                  className="size-4 rounded accent-primary"
                />
                <span className="text-sm text-muted-foreground">{t('required')}</span>
              </label>

              <ShowWhenSelect field={field} earlier={earlier} onUpdate={onUpdate} tall />

              {field.type === 'FILE' && <FileFieldNote />}

              {isChoiceType && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">
                      {t('options')} <span className="tabular-nums">({field.options.length})</span>
                    </Label>
                    <Badge variant="outline" className="text-[10px]">{t('optionsHint')}</Badge>
                  </div>
                  <div className="max-h-[40vh] space-y-1.5 overflow-y-auto pe-1">
                    {field.options.map((opt, oi) => (
                      <div key={oi} className="flex gap-1.5">
                        <Input
                          value={opt}
                          onChange={(e) => onUpdateOption(oi, e.target.value)}
                          onPaste={(e) => {
                            const text = e.clipboardData.getData('text');
                            if (/[\r\n]/.test(text.trim())) { e.preventDefault(); onPasteOptions(oi, text); }
                          }}
                          maxLength={MAX_OPTION_LENGTH}
                          placeholder={`${t('option')} ${oi + 1}`}
                          className="h-11 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveOption(oi)}
                          className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:text-destructive"
                          aria-label="Remove option"
                        >
                          <Trash2 className="size-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1 text-xs"
                    onClick={onAddOption}
                  >
                    <Plus className="size-3" /> {t('addOption')}
                  </Button>
                </div>
              )}

              {!(field.labelKey && field._seed && field.label.trim() === field._seed.label) && field.label.trim() !== '' && (
                <TranslationsEditor
                  row={field}
                  sourceLocale={sourceLocale}
                  onChange={(patch) => onUpdate(patch)}
                  tall
                />
              )}
            </div>

            {/* Sticky footer */}
            <div className="flex gap-2 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button variant="outline" className="h-11 flex-1" onClick={handleCancel}>
                {t('cancel')}
              </Button>
              <Button className="h-11 flex-1" onClick={() => setOpen(false)}>
                {t('done')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
