import { z } from 'zod';
import { INTERACTION_DIRECTIONS, INTERACTION_TYPES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());

/** `YYYY-MM-DD`. */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');
/** ISO 8601 datetime. */
const isoDateTime = z.string().datetime({ message: 'Date/heure invalide.' });

/**
 * `contactId`/`organizationId` are the only link types the UI offers in this
 * prompt (dev rules note in the Prompt 2 plan) — the DB CHECK also accepts
 * startup/expert/partnership/program/oi_project, which later prompts will add
 * pickers for without needing to touch this schema's shape.
 */
export const interactionInputSchema = z
  .object({
    type: z.enum(INTERACTION_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
    direction: z.enum(INTERACTION_DIRECTIONS).optional(),
    subject: z.string().trim().min(1, "L'objet est requis.").max(200),
    body: optionalTrimmed,
    occurredAt: isoDateTime,
    durationMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    outcome: optionalTrimmed,
    contactId: optionalTrimmed,
    organizationId: optionalTrimmed,
    nextAction: optionalTrimmed,
    nextActionDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
    nextActionDone: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (!data.contactId && !data.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Rattachez cette interaction à un contact ou une organisation.',
      });
    }
  });

export type InteractionInput = z.infer<typeof interactionInputSchema>;

/**
 * NOTE: the "at least one link" invariant is deliberately NOT checked here.
 * zod's `z.object().parse()` always materializes every optional key in its
 * output (as `undefined` when absent), so `'contactId' in parsed` is true
 * whether or not the client actually sent it — there is no reliable way to
 * distinguish "omitted" from "explicitly cleared" at this layer. The service
 * layer merges the patch onto the EXISTING row and checks the resulting
 * contactId/organizationId instead, which is what actually determines whether
 * the write would violate the DB CHECK.
 */
export const interactionUpdateSchema = z.object({
  type: z.enum(INTERACTION_TYPES).optional(),
  direction: z.enum(INTERACTION_DIRECTIONS).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: optionalTrimmed,
  occurredAt: isoDateTime.optional(),
  durationMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  outcome: optionalTrimmed,
  contactId: optionalTrimmed,
  organizationId: optionalTrimmed,
  nextAction: optionalTrimmed,
  nextActionDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  nextActionDone: z.boolean().optional(),
});

export const interactionListQuerySchema = z.object({
  contactId: optionalTrimmed,
  organizationId: optionalTrimmed,
  type: z.enum(INTERACTION_TYPES).optional(),
  /** Only interactions with an unfinished next action, due on/before today. */
  nextActionDue: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
