import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');
const isoDateTime = z.string().datetime({ message: 'Date/heure invalide.' });

/**
 * All 10 link columns the schema allows on crm_tasks are accepted here —
 * `bookingId`/`paymentId` joined the other 8 in Prompt 5 once Space Bookings
 * and Payments shipped CRUD. No dialog exposes pickers for any of these
 * beyond Organization/Contact; the rest are only ever set "locked" from that
 * entity's own detail page (see TaskFormDialog).
 */
export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Le titre est requis.').max(200),
    description: optionalTrimmed,
    priority: z.enum(TASK_PRIORITIES).default('MOYENNE'),
    status: z.enum(TASK_STATUSES).default('INBOX'),
    dueDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
    dueAt: z.preprocess(emptyToUndefined, isoDateTime.optional()),
    assigneeId: optionalTrimmed,
    contactId: optionalTrimmed,
    organizationId: optionalTrimmed,
    opportunityId: optionalTrimmed,
    startupId: optionalTrimmed,
    expertId: optionalTrimmed,
    partnershipId: optionalTrimmed,
    programId: optionalTrimmed,
    oiProjectId: optionalTrimmed,
    bookingId: optionalTrimmed,
    paymentId: optionalTrimmed,
  })
  .superRefine((data, ctx) => {
    if (
      !data.contactId && !data.organizationId && !data.opportunityId && !data.startupId &&
      !data.expertId && !data.partnershipId && !data.programId && !data.oiProjectId &&
      !data.bookingId && !data.paymentId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Rattachez cette tâche à au moins un élément.',
      });
    }
  });

export type TaskInput = z.infer<typeof taskInputSchema>;

/**
 * As with interactions, the "at least one link" invariant is enforced in the
 * service layer against the MERGED row, not here — see the note in
 * validation/interactions.ts for why zod can't reliably do it on a partial.
 */
export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalTrimmed,
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  dueAt: z.preprocess(emptyToUndefined, isoDateTime.optional()),
  assigneeId: optionalTrimmed,
  contactId: optionalTrimmed,
  organizationId: optionalTrimmed,
  opportunityId: optionalTrimmed,
  startupId: optionalTrimmed,
  expertId: optionalTrimmed,
  partnershipId: optionalTrimmed,
  programId: optionalTrimmed,
  oiProjectId: optionalTrimmed,
  bookingId: optionalTrimmed,
  paymentId: optionalTrimmed,
});

export const taskListQuerySchema = z.object({
  q: optionalTrimmed,
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: optionalTrimmed,
  contactId: optionalTrimmed,
  organizationId: optionalTrimmed,
  opportunityId: optionalTrimmed,
  startupId: optionalTrimmed,
  expertId: optionalTrimmed,
  partnershipId: optionalTrimmed,
  programId: optionalTrimmed,
  oiProjectId: optionalTrimmed,
  bookingId: optionalTrimmed,
  paymentId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
