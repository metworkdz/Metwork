/**
 * METWORK OS CRM — Opportunity input validation.
 */
import { z } from 'zod';
import { OPPORTUNITY_STAGES, OPPORTUNITY_TYPES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');

export const opportunityInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Le titre est requis.').max(200),
    organizationId: optionalTrimmed,
    contactId: optionalTrimmed,
    type: z.enum(OPPORTUNITY_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
    stage: z.enum(OPPORTUNITY_STAGES).default('NOUVEAU_LEAD'),
    amount: z.coerce.number().int().min(0).optional(),
    probability: z.coerce.number().int().min(0).max(100).optional(),
    expectedCloseDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
    lostReason: optionalTrimmed,
    source: optionalTrimmed,
    ownerId: optionalTrimmed,
    description: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (!data.organizationId && !data.contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Rattachez cette opportunité à une organisation ou un contact.',
      });
    }
  });

export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

/**
 * As with Tasks/Interactions, the "at least one link" invariant is enforced
 * in the service layer against the MERGED row, not here — zod always
 * materializes optional keys on `.parse()`, so it cannot tell "omitted" from
 * "explicitly cleared" on a partial. See validation/patch-utils.ts.
 */
export const opportunityUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  organizationId: optionalTrimmed,
  contactId: optionalTrimmed,
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  amount: z.coerce.number().int().min(0).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  lostReason: optionalTrimmed,
  source: optionalTrimmed,
  ownerId: optionalTrimmed,
  description: optionalTrimmed,
});

export const opportunityListQuerySchema = z.object({
  q: optionalTrimmed,
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  organizationId: optionalTrimmed,
  ownerId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
