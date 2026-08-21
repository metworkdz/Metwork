/**
 * METWORK OS CRM — Open Innovation project input validation.
 * Unlike Opportunities/Partnerships, an OI project has no required link — the
 * schema's `crm_oi_projects` carries no anti-orphan CHECK (product spec: a
 * project can start from a raw problem statement before any org is known).
 */
import { z } from 'zod';
import { OI_PARTICIPANT_STATUSES, OI_STAGES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');

export const oiProjectInputSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est requis.').max(200),
  organizationId: optionalTrimmed,
  contactId: optionalTrimmed,
  partnershipId: optionalTrimmed,
  stage: z.enum(OI_STAGES).default('ENTREPRISE_IDENTIFIEE'),
  problemStatement: optionalTrimmed,
  challengeStatement: optionalTrimmed,
  budget: z.coerce.number().int().min(0).optional(),
  currency: z.string().trim().min(1).max(3).default('DZD'),
  startDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  targetEndDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  ownerId: optionalTrimmed,
  notes: optionalTrimmed,
});

export type OiProjectInput = z.infer<typeof oiProjectInputSchema>;

export const oiProjectUpdateSchema = oiProjectInputSchema.partial();

export const oiProjectListQuerySchema = z.object({
  q: optionalTrimmed,
  stage: z.enum(OI_STAGES).optional(),
  organizationId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Mobilization: add/update a startup or expert on an OI project. */
export const oiParticipantInputSchema = z.object({
  role: optionalTrimmed,
  status: z.enum(OI_PARTICIPANT_STATUSES).default('PRESSENTIE'),
});

export const oiParticipantUpdateSchema = z.object({
  role: optionalTrimmed,
  status: z.enum(OI_PARTICIPANT_STATUSES).optional(),
});
