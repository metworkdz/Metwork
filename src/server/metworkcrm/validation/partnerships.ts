/**
 * METWORK OS CRM — Partnership input validation.
 * A partnership is always with an organization (schema `organization_id`
 * is NOT NULL, RESTRICT) — unlike Opportunities/Tasks/Interactions there is
 * no "contact OR organization" choice to make here.
 */
import { z } from 'zod';
import { PARTNERSHIP_STAGES, PARTNERSHIP_TYPES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');

const contactLinkSchema = z.object({
  contactId: z.string().trim().min(1),
  role: optionalTrimmed,
});

export const partnershipInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis.').max(200),
  organizationId: z.string().trim().min(1, "L'organisation est requise."),
  type: z.enum(PARTNERSHIP_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
  stage: z.enum(PARTNERSHIP_STAGES).default('PROSPECT'),
  description: optionalTrimmed,
  valueAmount: z.coerce.number().int().min(0).optional(),
  startDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  endDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  renewalDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  ownerId: optionalTrimmed,
  platformPartnerMembershipId: optionalTrimmed,
  /** Replaces the full `crm_partnership_contacts` set on write — same shape as Contacts' org-junction. */
  contacts: z.array(contactLinkSchema).max(50).optional(),
});

export type PartnershipInput = z.infer<typeof partnershipInputSchema>;

export const partnershipUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  organizationId: z.string().trim().min(1).optional(),
  type: z.enum(PARTNERSHIP_TYPES).optional(),
  stage: z.enum(PARTNERSHIP_STAGES).optional(),
  description: optionalTrimmed,
  valueAmount: z.coerce.number().int().min(0).optional(),
  startDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  endDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  renewalDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  ownerId: optionalTrimmed,
  platformPartnerMembershipId: optionalTrimmed,
  contacts: z.array(contactLinkSchema).max(50).optional(),
});

export const partnershipListQuerySchema = z.object({
  q: optionalTrimmed,
  type: z.enum(PARTNERSHIP_TYPES).optional(),
  stage: z.enum(PARTNERSHIP_STAGES).optional(),
  organizationId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
