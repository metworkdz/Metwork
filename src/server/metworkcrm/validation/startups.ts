/**
 * METWORK OS CRM — Startup input validation.
 *
 * `platformListingId` links a CRM startup to a `StartupListingRecord` in the
 * platform's JSON store — when present, `name` stays NULL and the display
 * name lives in `displayNameCache` (schema doc §7.4). Creating a CRM-only
 * startup (no platform link) requires `name`.
 */
import { z } from 'zod';
import { STARTUP_STAGES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email('E-mail invalide.').optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().trim().url('URL invalide.').optional());

export const startupInputSchema = z
  .object({
    platformListingId: optionalTrimmed,
    name: optionalTrimmed,
    sector: optionalTrimmed,
    city: optionalTrimmed,
    website: optionalUrl,
    description: optionalTrimmed,
    founderName: optionalTrimmed,
    founderEmail: optionalEmail,
    founderPhone: optionalTrimmed,
    organizationId: optionalTrimmed,
    primaryContactId: optionalTrimmed,
    pipelineStage: z.enum(STARTUP_STAGES).default('LEAD'),
    assignedExpertId: optionalTrimmed,
    notes: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (!data.platformListingId && !data.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Indiquez un nom, ou liez cette fiche à une startup de la plateforme.',
      });
    }
  });

export type StartupInput = z.infer<typeof startupInputSchema>;

export const startupUpdateSchema = z.object({
  platformListingId: optionalTrimmed,
  name: optionalTrimmed,
  sector: optionalTrimmed,
  city: optionalTrimmed,
  website: optionalUrl,
  description: optionalTrimmed,
  founderName: optionalTrimmed,
  founderEmail: optionalEmail,
  founderPhone: optionalTrimmed,
  organizationId: optionalTrimmed,
  primaryContactId: optionalTrimmed,
  pipelineStage: z.enum(STARTUP_STAGES).optional(),
  assignedExpertId: optionalTrimmed,
  notes: optionalTrimmed,
});

export const startupListQuerySchema = z.object({
  q: optionalTrimmed,
  pipelineStage: z.enum(STARTUP_STAGES).optional(),
  sector: optionalTrimmed,
  organizationId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
