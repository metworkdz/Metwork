/**
 * METWORK OS CRM — Payment input validation (product spec §4.14).
 *
 * Strict boundary, repeated because it's the one that matters most here:
 * "ne remplace pas une comptabilité". No FK to wallets/transactions/invoices/
 * income — `externalRef` stays free text (e.g. a platform invoice number).
 */
import { z } from 'zod';
import { PAYMENT_DIRECTIONS, PAYMENT_METHODS, PAYMENT_STATUSES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');

export const paymentInputSchema = z
  .object({
    label: z.string().trim().min(1, 'Le libellé est requis.').max(200),
    amount: z.coerce.number().int().min(0),
    currency: z.string().trim().min(1).max(3).default('DZD'),
    direction: z.enum(PAYMENT_DIRECTIONS).default('IN'),
    status: z.enum(PAYMENT_STATUSES).default('EN_ATTENTE'),
    dueDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
    method: z.enum(PAYMENT_METHODS).optional(),
    opportunityId: optionalTrimmed,
    spaceBookingId: optionalTrimmed,
    programId: optionalTrimmed,
    organizationId: optionalTrimmed,
    contactId: optionalTrimmed,
    partnershipId: optionalTrimmed,
    oiProjectId: optionalTrimmed,
    externalRef: optionalTrimmed,
    notes: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (
      !data.opportunityId && !data.spaceBookingId && !data.programId && !data.organizationId &&
      !data.contactId && !data.partnershipId && !data.oiProjectId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Rattachez ce paiement à au moins un élément.',
      });
    }
  });

export type PaymentInput = z.infer<typeof paymentInputSchema>;

/**
 * As elsewhere, the "at least one link" invariant is enforced in the service
 * layer against the MERGED row — zod can't reliably do it on a partial.
 */
export const paymentUpdateSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  amount: z.coerce.number().int().min(0).optional(),
  currency: z.string().trim().min(1).max(3).optional(),
  direction: z.enum(PAYMENT_DIRECTIONS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  dueDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  method: z.enum(PAYMENT_METHODS).optional(),
  opportunityId: optionalTrimmed,
  spaceBookingId: optionalTrimmed,
  programId: optionalTrimmed,
  organizationId: optionalTrimmed,
  contactId: optionalTrimmed,
  partnershipId: optionalTrimmed,
  oiProjectId: optionalTrimmed,
  externalRef: optionalTrimmed,
  notes: optionalTrimmed,
});

export const paymentListQuerySchema = z.object({
  q: optionalTrimmed,
  status: z.enum(PAYMENT_STATUSES).optional(),
  direction: z.enum(PAYMENT_DIRECTIONS).optional(),
  /** Only payments with dueDate in the past and not yet PAYE/ANNULE. */
  overdue: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
