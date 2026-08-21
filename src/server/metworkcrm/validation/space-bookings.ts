/**
 * METWORK OS CRM — Space booking input validation.
 *
 * Product spec §4.13: a manual internal log, not a real reservation system —
 * `platformSpaceId` is a free-text reference label only (never exposed in the
 * form, same posture as `platformListingId` on Startups) and this module never
 * touches the canonical availability engine.
 */
import { z } from 'zod';
import { BOOKING_STATUSES, SPACE_TYPES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const isoDateTime = z.preprocess(emptyToUndefined, z.string().datetime({ message: 'Date/heure invalide.' }).optional());

export const spaceBookingInputSchema = z
  .object({
    spaceLabel: z.string().trim().min(1, "Le nom de l'espace est requis.").max(200),
    spaceType: z.enum(SPACE_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
    organizationId: optionalTrimmed,
    contactId: optionalTrimmed,
    opportunityId: optionalTrimmed,
    startAt: isoDateTime,
    endAt: isoDateTime,
    attendees: z.coerce.number().int().min(0).optional(),
    quotedAmount: z.coerce.number().int().min(0).optional(),
    finalAmount: z.coerce.number().int().min(0).optional(),
    status: z.enum(BOOKING_STATUSES).default('DEMANDE'),
    notes: optionalTrimmed,
    ownerId: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (!data.organizationId && !data.contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Rattachez cette réservation à une organisation ou un contact.',
      });
    }
  });

export type SpaceBookingInput = z.infer<typeof spaceBookingInputSchema>;

/**
 * As with Opportunities, the "at least one link" invariant is enforced in the
 * service layer against the MERGED row, not here — see the note in
 * validation/interactions.ts for why zod can't reliably do it on a partial.
 */
export const spaceBookingUpdateSchema = z.object({
  spaceLabel: z.string().trim().min(1).max(200).optional(),
  spaceType: z.enum(SPACE_TYPES).optional(),
  organizationId: optionalTrimmed,
  contactId: optionalTrimmed,
  opportunityId: optionalTrimmed,
  startAt: isoDateTime,
  endAt: isoDateTime,
  attendees: z.coerce.number().int().min(0).optional(),
  quotedAmount: z.coerce.number().int().min(0).optional(),
  finalAmount: z.coerce.number().int().min(0).optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  notes: optionalTrimmed,
  ownerId: optionalTrimmed,
});

export const spaceBookingListQuerySchema = z.object({
  q: optionalTrimmed,
  spaceType: z.enum(SPACE_TYPES).optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  organizationId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
