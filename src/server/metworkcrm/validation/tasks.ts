import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');
const isoDateTime = z.string().datetime({ message: 'Date/heure invalide.' });

/**
 * `contactId`/`organizationId` are the only link types the UI offers in this
 * prompt — see the matching note in validation/interactions.ts. The DB CHECK
 * also accepts opportunity/startup/expert/partnership/program/oi_project/
 * booking/payment, which later prompts add pickers for.
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
  })
  .superRefine((data, ctx) => {
    if (!data.contactId && !data.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationId'],
        message: 'Rattachez cette tâche à un contact ou une organisation.',
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
});

export const taskListQuerySchema = z.object({
  q: optionalTrimmed,
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: optionalTrimmed,
  contactId: optionalTrimmed,
  organizationId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
