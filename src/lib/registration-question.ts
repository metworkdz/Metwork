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

/** The shape both the store record and the DTO satisfy. */
export interface TranslatableQuestion {
  label: string;
  labelKey?: string | null;
  options?: string[] | null;
  optionKeys?: string[] | null;
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

/** The question text to show. Falls back to the stored label. */
export function questionLabel(field: TranslatableQuestion, translate: SafeTranslate): string {
  return lookup(translate, field.labelKey) ?? field.label;
}

/**
 * The choices to show, positionally aligned with `options`. A key that does
 * not resolve falls back to the stored option at the same index, so a
 * partially-keyed field degrades one option at a time instead of all at once.
 */
export function questionOptions(
  field: TranslatableQuestion,
  translate: SafeTranslate,
): string[] | null {
  const options = field.options ?? null;
  if (!options) return null;
  const keys = field.optionKeys;
  if (!keys?.length) return options;
  return options.map((stored, i) => lookup(translate, keys[i]) ?? stored);
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
