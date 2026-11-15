/**
 * Request shape for a question's translations, shared by the incubator and
 * consultant save routes (and the AI-draft routes) so they accept exactly the
 * same thing. Normalisation — dropping a language whose choices do not line up,
 * removing empty ones — is not done here but in `normalizeTranslations`, at the
 * moment of storing.
 */
import { z } from 'zod';
import { locales } from '@/i18n/config';
import { MAX_OPTION_LENGTH } from '@/lib/registration-options';

export const localeSchema = z.enum(locales);

const text = z.string().trim().max(MAX_OPTION_LENGTH);

export const translationSchema = z.object({
  label: text.optional(),
  // Generous bound: a 58-wilaya dropdown is the long case we have seen.
  options: z.array(text).max(200).nullable().optional(),
});

/** The translation-related fields of one question in a save request. */
export const translationFields = {
  /** The language the question's own words are written in. */
  sourceLocale: localeSchema.nullable().optional().transform((v) => v ?? null),
  translations: z
    .object({ en: translationSchema, fr: translationSchema, ar: translationSchema })
    .partial()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** Languages that are machine drafts nobody has read yet. */
  draftedLocales: z.array(localeSchema).max(3).nullable().optional().transform((v) => v ?? null),
};
