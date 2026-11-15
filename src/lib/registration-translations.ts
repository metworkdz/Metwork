/**
 * A host-written registration question, shown to each visitor in their language.
 *
 * Seeded questions already localize through `labelKey` (see
 * `registration-question.ts`). A question the host typed is text in whatever
 * language they wrote — so an Arabic or French applicant got an English form.
 * Each such question can now carry translations of its wording and of its
 * choices.
 *
 * WHAT IS STORED, AND WHAT IS ANSWERED. `label` and `options` stay the host's own
 * words (the SOURCE): the dashboard, the CSV export and the answer summary all
 * read them. Translations are only for DISPLAY. A visitor who picks "Oui" in
 * French is recorded as the source option "Yes", so counts, "ask only if" rules
 * and exports never split by the language someone happened to browse in.
 *
 * `draftedLocales` marks languages that were machine-drafted and not yet read by
 * a person — the builder shows them as drafts; the visitor sees them either way.
 *
 * Dependency-free and client-safe: the builder, the public form and the save
 * routes share these rules so they cannot disagree.
 */
import { locales, type Locale } from '@/i18n/config';
import { MAX_OPTION_LENGTH } from '@/lib/registration-options';

export interface FieldTranslation {
  label?: string;
  /** Positionally aligned with the question's source `options`. */
  options?: string[] | null;
}

export type FieldTranslations = Partial<Record<Locale, FieldTranslation>>;

const CHOICE_TYPES = ['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'];

const trim = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

/**
 * What a question's translations become once they are made safe to store:
 *   • text is trimmed and bounded;
 *   • a language's choices are kept only if they line up one-for-one with the
 *     source choices (a list of a different length cannot be matched up, and a
 *     wrong match would show the wrong words) — otherwise just that language's
 *     choices are dropped and it falls back to the source;
 *   • a language with nothing in it is removed, and `drafted` only names languages
 *     that remain.
 */
export function normalizeTranslations(
  input: FieldTranslations | null | undefined,
  base: { type: string; options?: readonly string[] | null },
  drafted?: readonly Locale[] | null,
): { translations: FieldTranslations | null; drafted: Locale[] | null } {
  const out: FieldTranslations = {};
  const isChoice = CHOICE_TYPES.includes(base.type);
  const expected = base.options?.length ?? 0;

  for (const l of locales) {
    const t = input?.[l];
    if (!t) continue;
    const label = trim(t.label).slice(0, MAX_OPTION_LENGTH);
    let options: string[] | null = null;
    if (isChoice && Array.isArray(t.options)) {
      const cleaned = t.options.map((o) => trim(o).slice(0, MAX_OPTION_LENGTH));
      if (cleaned.length === expected && cleaned.every((o) => o !== '')) options = cleaned;
    }
    if (!label && !options) continue;
    out[l] = { ...(label ? { label } : {}), ...(options ? { options } : {}) };
  }

  const kept = Object.keys(out) as Locale[];
  const stillDrafted = (drafted ?? []).filter((l) => kept.includes(l));
  return {
    translations: kept.length ? out : null,
    drafted: stillDrafted.length ? locales.filter((l) => stillDrafted.includes(l)) : null,
  };
}

/** Languages (other than the source) that have a label for this question. */
export function translatedLocales(translations: FieldTranslations | null | undefined): Locale[] {
  return locales.filter((l) => trim(translations?.[l]?.label) !== '');
}

/**
 * The translation fields of a question to carry into `normalizeTranslations`
 * after the host edits the source wording: machine drafts are discarded (they
 * described the old wording and can be redrafted), while anything a person wrote
 * or marked as checked is kept.
 */
export function dropDraftedTranslations(
  translations: FieldTranslations | null | undefined,
  drafted: readonly Locale[] | null | undefined,
): { translations: FieldTranslations | null; drafted: Locale[] | null } {
  const dropped = new Set(drafted ?? []);
  const kept: FieldTranslations = {};
  for (const l of locales) {
    if (translations?.[l] && !dropped.has(l)) kept[l] = translations[l];
  }
  return { translations: Object.keys(kept).length ? kept : null, drafted: null };
}
