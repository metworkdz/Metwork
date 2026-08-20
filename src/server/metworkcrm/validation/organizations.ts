/**
 * METWORK OS CRM — Organization input validation.
 * French messages: the CRM UI is French-only, no next-intl (dev rules R-5).
 */
import { z } from 'zod';
import { ORG_SIZES, ORG_TYPES, RECORD_STATUSES } from '../db/schema';

/** Empty string → undefined, so an untouched optional input doesn't fail its own format check. */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalEmail = z.preprocess(
  emptyToUndefined,
  z.string().trim().toLowerCase().email('E-mail invalide.').optional(),
);
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url('URL invalide.').optional(),
);

export const organizationInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis.').max(200),
  legalName: optionalTrimmed,
  type: z.enum(ORG_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
  sector: optionalTrimmed,
  size: z.enum(ORG_SIZES).optional(),
  city: optionalTrimmed,
  wilaya: optionalTrimmed,
  country: z.string().trim().min(1).max(2).default('DZ'),
  website: optionalUrl,
  linkedinUrl: optionalUrl,
  email: optionalEmail,
  phone: optionalTrimmed,
  address: optionalTrimmed,
  description: optionalTrimmed,
  status: z.enum(RECORD_STATUSES).default('PROSPECT'),
  source: optionalTrimmed,
  ownerId: optionalTrimmed,
  notes: optionalTrimmed,
  platformIncubatorId: optionalTrimmed,
  platformUserId: optionalTrimmed,
});

export type OrganizationInput = z.infer<typeof organizationInputSchema>;

/** PATCH accepts a partial — every field optional, but still validated when present. */
export const organizationUpdateSchema = organizationInputSchema.partial();

export const organizationListQuerySchema = z.object({
  q: optionalTrimmed,
  type: z.enum(ORG_TYPES).optional(),
  sector: optionalTrimmed,
  city: optionalTrimmed,
  status: z.enum(RECORD_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
