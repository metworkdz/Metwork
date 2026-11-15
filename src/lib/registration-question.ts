/**
 * How a registration question is worded for the person reading it.
 *
 * A question reaches the public form one of two ways:
 *   • from the seeded default application set — it carries a `labelKey` (and
 *     `optionKeys`) into the `defaultQuestions` i18n namespace, so it renders
 *     in the VISITOR's locale;
 *   • written by the host in the form builder — it is text, in whatever
 *     language they typed, and nobody may translate it.
 *
 * The seeded set used to be resolved to text once, at program-creation time,
 * in whatever locale the host happened to be using, and frozen into the
 * database. An Arabic visitor got English questions on an otherwise-Arabic
 * page, and editing the message files fixed nothing because the text was
 * already persisted. This module is the one place that decides, so the form,
 * the builder preview and any future surface can never answer differently.
 *
 * Dependency-free on purpose: the caller supplies the translate function
 * (`useTranslations('defaultQuestions')` on the client, `getTranslations` on
 * the server), which keeps this importable from anywhere.
 */
import type { Locale } from '@/i18n/config';
import type { FieldTranslations } from '@/lib/registration-translations';

/** The shape both the store record and the DTO satisfy. */
export interface TranslatableQuestion {
  label: string;
  labelKey?: string | null;
  options?: string[] | null;
  optionKeys?: string[] | null;
  /** Host translations of a host-written question — see `registration-translations.ts`. */
  translations?: FieldTranslations | null;
}

/**
 * Look a key up, returning null rather than throwing or rendering a marker
 * when it is missing. next-intl surfaces an unknown key as an error string,
 * which would put `defaultQuestions.startupName` in front of an applicant —
 * worse than the stored text we already have.
 */
export type SafeTranslate = (key: string) => string;

function lookup(translate: SafeTranslate, key: string | null | undefined): string | null {
  if (!key) return null;
  try {
    const value = translate(key);
    // next-intl echoes the full path back when a key is missing.
    if (!value || value === key || value.endsWith(`.${key}`)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * The question text to show. A seeded question resolves through its key; a
 * host-written one through the host's translation for `locale` when it has one.
 * Anything else shows the stored label — the host's own words — so a missing
 * translation is never an empty question. Pass no `locale` on the owner's
 * surfaces, which read the source wording.
 */
export function questionLabel(
  field: TranslatableQuestion,
  translate: SafeTranslate,
  locale?: Locale | string,
): string {
  const keyed = lookup(translate, field.labelKey);
  if (keyed) return keyed;
  const own = locale ? (field.translations?.[locale as Locale]?.label ?? '').trim() : '';
  return own || field.label;
}

/**
 * The choices to show, positionally aligned with `options`. A key that does
 * not resolve falls back to the stored option at the same index, so a
 * partially-keyed field degrades one option at a time instead of all at once.
 */
export function questionOptions(
  field: TranslatableQuestion,
  translate: SafeTranslate,
  locale?: Locale | string,
): string[] | null {
  const options = field.options ?? null;
  if (!options) return null;
  const keys = field.optionKeys;
  if (keys?.length) return options.map((stored, i) => lookup(translate, keys[i]) ?? stored);
  // A host translation of the choices applies only when it lines up with the
  // source choices one-for-one; otherwise the source is shown, never a guess.
  const own = locale ? field.translations?.[locale as Locale]?.options : undefined;
  if (own && own.length === options.length && own.every((o) => o.trim() !== '')) return own.map((o) => o.trim());
  return options;
}

/** One selectable choice: what is SHOWN, and what is RECORDED when it is picked. */
export interface Choice {
  value: string;
  label: string;
}

/**
 * The choices of a question as the public form renders them.
 *
 * A host-written question records the SOURCE option whatever language it was
 * shown in, so "Oui" and "نعم" both become "Yes" and counts, "ask only if" rules
 * and exports never split by language. A seeded question keeps its long-standing
 * behaviour (the answer is the text that was shown); the answer summary already
 * folds those together across languages.
 */
export function questionChoices(
  field: TranslatableQuestion,
  translate: SafeTranslate,
  locale?: Locale | string,
): Choice[] | null {
  const options = field.options ?? null;
  if (!options) return null;
  const labels = questionOptions(field, translate, locale) ?? options;
  const seeded = !!field.optionKeys?.length;
  return options.map((source, i) => ({ value: seeded ? labels[i]! : source, label: labels[i]! }));
}

/**
 * Drop the template keys once a host edits the wording — their words win over
 * the seeded translation, and a stale key would silently overwrite them on the
 * public page. Compares against what the field looked like when it was loaded.
 */
export function keysSurvivingEdit(
  original: TranslatableQuestion | undefined,
  next: { label: string; options: string[] },
): { labelKey: string | null; optionKeys: string[] | null } {
  if (!original) return { labelKey: null, optionKeys: null };
  const labelKey = original.label === next.label ? (original.labelKey ?? null) : null;

  const originalOptions = original.options ?? [];
  const sameOptions =
    originalOptions.length === next.options.length &&
    originalOptions.every((o, i) => o === next.options[i]);
  const optionKeys = sameOptions ? (original.optionKeys ?? null) : null;

  return { labelKey, optionKeys };
}
