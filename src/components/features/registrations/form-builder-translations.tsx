'use client';

/**
 * The translation half of the registration form builder.
 *
 * A host-written question shows in the host's language to everyone, unless it
 * carries translations. Two pieces:
 *
 *   • TranslateBar — once per form: which language the questions are WRITTEN in,
 *     and a button that drafts the other two with Claude.
 *   • TranslationsEditor — once per question: the wording and the choices in each
 *     other language, with a draft marker until the host has read it.
 *
 * Nothing here talks to the server; the builder owns state and saving.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Languages, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { locales, localeMetadata, type Locale } from '@/i18n/config';
import { translatedLocales, type FieldTranslations } from '@/lib/registration-translations';
import { MAX_OPTION_LENGTH } from '@/lib/registration-options';
import { cn } from '@/lib/utils';

/** What the editor needs to know about one question. */
export interface TranslatableRow {
  label: string;
  type: string;
  /** The source choices (as the builder holds them, possibly with blank rows). */
  options: string[];
  translations: FieldTranslations;
  drafted: Locale[];
  /** Bumped when the translations change from outside the editor, so it re-reads them. */
  rev: number;
}

const CHOICE = ['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'];

export const sourceChoiceCount = (row: Pick<TranslatableRow, 'options'>) =>
  row.options.filter((o) => o.trim() !== '').length;

/* ─────────────────────────── Per form ─────────────────────────── */

export function TranslateBar({
  sourceLocale,
  onSourceChange,
  onTranslate,
  busy,
  note,
  error,
}: {
  sourceLocale: Locale;
  onSourceChange: (l: Locale) => void;
  onTranslate: () => void;
  busy: boolean;
  note: string;
  error: string;
}) {
  const t = useTranslations('formBuilder');
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fb-source-locale" className="text-xs font-medium text-muted-foreground">
            {t('writtenIn')}
          </Label>
          <select
            id="fb-source-locale"
            value={sourceLocale}
            onChange={(e) => onSourceChange(e.target.value as Locale)}
            className="flex h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {locales.map((l) => (
              <option key={l} value={l}>{localeMetadata[l].nativeName}</option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onTranslate} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {busy ? t('translating') : t('translateAll')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('translateHint')}</p>
      {note && <p role="status" className="text-xs text-emerald-700">{note}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/* ─────────────────────────── Per question ─────────────────────────── */

export function TranslationsEditor({
  row,
  sourceLocale,
  onChange,
  tall,
}: {
  row: TranslatableRow;
  sourceLocale: Locale;
  /** Patch the question's translations and which of them are still unreviewed drafts. */
  onChange: (patch: { translations: FieldTranslations; drafted: Locale[] }) => void;
  /** Larger touch targets for the mobile sheet. */
  tall?: boolean;
}) {
  const t = useTranslations('formBuilder');
  const [open, setOpen] = useState(false);
  // The source language is the question itself — unless a translation for it
  // already exists, which would otherwise be invisible and uneditable.
  const shown = locales.filter((l) => l !== sourceLocale || row.translations[l]);
  const filled = translatedLocales(row.translations);
  const hasDraft = row.drafted.length > 0;

  function setLocale(l: Locale, next: { label?: string; options?: string[] | null }, reviewed: boolean) {
    const current = row.translations[l] ?? {};
    const merged = { ...current, ...next };
    if (!merged.label?.trim()) delete merged.label;
    if (!merged.options?.length) delete merged.options;
    const translations: FieldTranslations = { ...row.translations };
    if (merged.label || merged.options) translations[l] = merged; else delete translations[l];
    onChange({ translations, drafted: reviewed ? row.drafted.filter((d) => d !== l) : row.drafted });
  }

  return (
    <div className="rounded-md border border-border/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-2 px-3 text-start text-xs font-medium text-muted-foreground hover:text-foreground', tall ? 'min-h-11' : 'min-h-9')}
      >
        <Languages className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t('translations')}</span>
        <span className="flex gap-1">
          {filled.map((l) => (
            <span
              key={l}
              className={cn(
                'rounded px-1 py-0.5 text-[10px] uppercase',
                row.drafted.includes(l) ? 'bg-amber-100 text-amber-800' : 'bg-primary/10 text-primary',
              )}
            >
              {l}
            </span>
          ))}
        </span>
        {hasDraft && <span className="text-[10px] text-amber-700">{t('translationDraft')}</span>}
        <span className="ms-auto">{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/70 p-3">
          {shown.map((l) => (
            <LocaleBlock
              // Re-read from props when the translations were changed from outside (AI draft).
              key={`${l}-${row.rev}`}
              locale={l}
              row={row}
              tall={tall}
              onLabel={(label) => setLocale(l, { label }, true)}
              onOptions={(options) => setLocale(l, { options }, true)}
              onChecked={() => onChange({ translations: row.translations, drafted: row.drafted.filter((d) => d !== l) })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LocaleBlock({
  locale,
  row,
  tall,
  onLabel,
  onOptions,
  onChecked,
}: {
  locale: Locale;
  row: TranslatableRow;
  tall?: boolean;
  onLabel: (label: string) => void;
  onOptions: (options: string[] | null) => void;
  onChecked: () => void;
}) {
  const t = useTranslations('formBuilder');
  const meta = localeMetadata[locale];
  const current = row.translations[locale];
  const isChoice = CHOICE.includes(row.type);
  const expected = sourceChoiceCount(row);
  // Held as raw text so a trailing newline can be typed; parsed to one choice per line.
  const [text, setText] = useState((current?.options ?? []).join('\n'));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const mismatch = lines.length > 0 && lines.length !== expected;
  const isDraft = row.drafted.includes(locale);

  return (
    <div className="space-y-2" lang={locale} dir={meta.dir}>
      <div className="flex flex-wrap items-center gap-2" dir="ltr">
        <span className="text-xs font-semibold">{meta.nativeName}</span>
        {isDraft && (
          <>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{t('translationDraft')}</span>
            <button type="button" onClick={onChecked} className="text-[11px] font-medium text-primary hover:underline">
              {t('markChecked')}
            </button>
          </>
        )}
      </div>

      <Input
        value={current?.label ?? ''}
        onChange={(e) => onLabel(e.target.value)}
        maxLength={MAX_OPTION_LENGTH}
        placeholder={row.label || t('fieldLabelPlaceholder')}
        aria-label={`${t('fieldLabel')} — ${meta.nativeName}`}
        className={tall ? 'h-11 text-sm' : 'h-8 text-sm'}
      />

      {isChoice && (
        <div className="space-y-1">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const parsed = e.target.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
              onOptions(parsed.length ? parsed : null);
            }}
            rows={Math.min(8, Math.max(3, expected))}
            placeholder={t('translationOptionsPlaceholder', { count: expected })}
            aria-label={`${t('options')} — ${meta.nativeName}`}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className={cn('text-[11px] tabular-nums', mismatch ? 'text-destructive' : 'text-muted-foreground')} dir="ltr">
            {t('translationOptionsCount', { got: lines.length, expected })}
          </p>
        </div>
      )}
    </div>
  );
}
