/**
 * METWORK OS CRM — Programs & Events input validation.
 */
import { z } from 'zod';
import { PARTICIPANT_STATUSES, PAYMENT_DIRECTIONS, PAYMENT_METHODS, PAYMENT_STATUSES, PROGRAM_STAGES, PROGRAM_TYPES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email('E-mail invalide.').optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');

export const programInputSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est requis.').max(200),
  type: z.enum(PROGRAM_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
  stage: z.enum(PROGRAM_STAGES).default('IDEE'),
  startDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  endDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  city: optionalTrimmed,
  venue: optionalTrimmed,
  capacity: z.coerce.number().int().min(0).optional(),
  price: z.coerce.number().int().min(0).optional(),
  description: optionalTrimmed,
  ownerId: optionalTrimmed,
});

export type ProgramInput = z.infer<typeof programInputSchema>;

export const programUpdateSchema = programInputSchema.partial();

export const programListQuerySchema = z.object({
  q: optionalTrimmed,
  type: z.enum(PROGRAM_TYPES).optional(),
  stage: z.enum(PROGRAM_STAGES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** A participant needs a real Contact OR a walk-in name (schema CHECK). */
export const participantInputSchema = z
  .object({
    contactId: optionalTrimmed,
    startupId: optionalTrimmed,
    organizationId: optionalTrimmed,
    fullName: optionalTrimmed,
    email: optionalEmail,
    phone: optionalTrimmed,
    status: z.enum(PARTICIPANT_STATUSES).default('INSCRIT'),
    attended: z.boolean().default(false),
    satisfactionScore: z.coerce.number().int().min(1).max(5).optional(),
    amountDue: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.contactId && !data.fullName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fullName'],
        message: 'Indiquez un contact existant ou un nom.',
      });
    }
  });

export type ParticipantInput = z.infer<typeof participantInputSchema>;

export const participantUpdateSchema = z.object({
  contactId: optionalTrimmed,
  startupId: optionalTrimmed,
  organizationId: optionalTrimmed,
  fullName: optionalTrimmed,
  email: optionalEmail,
  phone: optionalTrimmed,
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  attended: z.boolean().optional(),
  satisfactionScore: z.coerce.number().int().min(1).max(5).optional(),
  amountDue: z.coerce.number().int().min(0).optional(),
});

export const trainerInputSchema = z.object({
  expertId: z.string().trim().min(1, "L'expert est requis."),
  fee: z.coerce.number().int().min(0).optional(),
  confirmed: z.boolean().default(false),
});

export const trainerUpdateSchema = z.object({
  fee: z.coerce.number().int().min(0).optional(),
  confirmed: z.boolean().optional(),
});

/** A partner needs a Partnership OR a plain Organization (schema CHECK). */
export const partnerInputSchema = z
  .object({
    partnershipId: optionalTrimmed,
    organizationId: optionalTrimmed,
    role: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (!data.partnershipId && !data.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Choisissez un partenariat ou une organisation.',
      });
    }
  });

export type PartnerInput = z.infer<typeof partnerInputSchema>;

/** Minimal ADMIN-only "add payment" mini-form on Program detail — see SESSION_LOG for scope. */
export const programPaymentInputSchema = z.object({
  label: z.string().trim().min(1, 'Le libellé est requis.').max(200),
  amount: z.coerce.number().int().min(0),
  direction: z.enum(PAYMENT_DIRECTIONS).default('IN'),
  status: z.enum(PAYMENT_STATUSES).default('EN_ATTENTE'),
  dueDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  method: z.enum(PAYMENT_METHODS).optional(),
});

export type ProgramPaymentFormInput = z.infer<typeof programPaymentInputSchema>;
