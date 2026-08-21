/**
 * METWORK OS CRM — Expert input validation.
 * Same identity rule as Startups: `platformMentorId` OR `name` is required.
 */
import { z } from 'zod';
import { EXPERT_STAGES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email('E-mail invalide.').optional());

/** JSON string[] in the DB — the API accepts/returns a plain string array. */
const specialtiesArray = z.array(z.string().trim().min(1)).max(30).optional();

export const expertInputSchema = z
  .object({
    platformMentorId: optionalTrimmed,
    name: optionalTrimmed,
    email: optionalEmail,
    phone: optionalTrimmed,
    city: optionalTrimmed,
    specialties: specialtiesArray,
    pipelineStage: z.enum(EXPERT_STAGES).default('PROSPECT'),
    dailyRate: z.coerce.number().int().min(0).optional(),
    organizationId: optionalTrimmed,
    contactId: optionalTrimmed,
    internalNotes: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (!data.platformMentorId && !data.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Indiquez un nom, ou liez cette fiche à un mentor de la plateforme.',
      });
    }
  });

export type ExpertInput = z.infer<typeof expertInputSchema>;

export const expertUpdateSchema = z.object({
  platformMentorId: optionalTrimmed,
  name: optionalTrimmed,
  email: optionalEmail,
  phone: optionalTrimmed,
  city: optionalTrimmed,
  specialties: specialtiesArray,
  pipelineStage: z.enum(EXPERT_STAGES).optional(),
  dailyRate: z.coerce.number().int().min(0).optional(),
  organizationId: optionalTrimmed,
  contactId: optionalTrimmed,
  internalNotes: optionalTrimmed,
});

export const expertListQuerySchema = z.object({
  q: optionalTrimmed,
  pipelineStage: z.enum(EXPERT_STAGES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
