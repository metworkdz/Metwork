/**
 * Shared HTTP handler for "draft translations of these questions" — one contract
 * for the incubator dashboard and the consultant portal; the route files resolve
 * who is asking and hand in the key their rate limit is counted on.
 *
 * It spends money (a model call), so it is rate limited per person, bounded in
 * size, and it stores nothing.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { MAX_FORM_FIELDS, MAX_OPTION_LENGTH } from '@/lib/registration-options';
import { localeSchema } from '@/server/registrations/translation-schema';
import { draftFormTranslations, type Translator } from '@/server/registrations/translate';

const text = z.string().trim().max(MAX_OPTION_LENGTH);

const bodySchema = z.object({
  sourceLocale: localeSchema,
  fields: z
    .array(
      z.object({
        label: text,
        options: z.array(text).max(200).nullable().optional(),
        targets: z.array(localeSchema).min(1).max(3),
      }),
    )
    .min(1)
    .max(MAX_FORM_FIELDS),
});

export async function handleTranslateForm(req: NextRequest, rateKey: string, translator?: Translator) {
  if (!(await checkRateLimitDistributed(`reg-form:translate:${rateKey}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many translation runs. Try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = bodySchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const res = await draftFormTranslations(input.sourceLocale, input.fields, translator);
  if (!res.ok) {
    return res.code === 'UNAVAILABLE'
      ? jsonError(503, 'TRANSLATION_UNAVAILABLE', 'Automatic translation is not available right now.')
      : jsonError(502, 'TRANSLATION_FAILED', 'The translation could not be drafted. Please try again.');
  }
  return json({ fields: res.fields });
}
