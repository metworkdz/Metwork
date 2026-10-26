/**
 * Text an author writes once and readers see in their own language — course,
 * module and lesson titles in the Academy.
 *
 * Stored as one object per field: the language it was written in plus any
 * translations. A reader gets their language, else the original, so a missing
 * translation never shows an empty title. `drafted` lists translations that
 * were machine-drafted and not yet reviewed by a person.
 *
 * Client-safe (no server imports): the same resolver renders on the server and
 * in the builder's live preview.
 */
import { locales, type Locale } from '@/i18n/config';

export interface LocalizedText {
  /** The language the author wrote in — the fallback for every reader. */
  source: Locale;
  en?: string;
  fr?: string;
  ar?: string;
  /** Translations drafted automatically and not yet reviewed. */
  drafted?: Locale[];
}

function clean(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A new text written in `source`. */
export function localizedText(source: Locale, value: string): LocalizedText {
  return { source, [source]: value.trim() };
}

/**
 * The text for a reader in `locale`: their language, else the original, else
 * any language that has text. '' only when the object holds no text at all.
 */
export function resolveText(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return '';
  const own = (locales as readonly string[]).includes(locale) ? clean(text[locale as Locale]) : '';
  if (own) return own;
  const original = clean(text[text.source]);
  if (original) return original;
  for (const l of locales) {
    const v = clean(text[l]);
    if (v) return v;
  }
  return '';
}

/** Languages with no text yet — what an automatic translation would fill. */
export function missingLocales(text: LocalizedText): Locale[] {
  return locales.filter((l) => !clean(text[l]));
}

/**
 * Set one language. Writing the source language or a reviewed translation
 * removes that language from `drafted`; `asDraft` marks a machine translation.
 */
export function withTranslation(text: LocalizedText, locale: Locale, value: string, asDraft = false): LocalizedText {
  const drafted = new Set(text.drafted ?? []);
  if (asDraft && locale !== text.source) drafted.add(locale);
  else drafted.delete(locale);
  const next: LocalizedText = { ...text, [locale]: value.trim() };
  if (drafted.size) next.drafted = locales.filter((l) => drafted.has(l));
  else delete next.drafted;
  return next;
}

/** Runtime shape check for text coming from a request body or the store. */
export function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== 'string' || !(locales as readonly string[]).includes(v.source)) return false;
  for (const l of locales) {
    if (v[l] !== undefined && typeof v[l] !== 'string') return false;
  }
  if (v.drafted !== undefined) {
    if (!Array.isArray(v.drafted) || !v.drafted.every((d) => (locales as readonly string[]).includes(d as string))) return false;
  }
  return clean(v[v.source as Locale] as string | undefined).length > 0;
}
