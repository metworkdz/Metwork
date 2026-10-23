/** Zod schemas for the freelancer workspace routes. */
import { z } from 'zod';
import { FREELANCER_PROJECT_STATUSES } from '@/server/db/store';

export const projectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  clientName: z.string().trim().max(120).nullable(),
  clientId: z.string().max(80).nullable(),
  status: z.enum(FREELANCER_PROJECT_STATUSES),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  amount: z.number().int().min(0).max(1_000_000_000).nullable(),
  notes: z.string().max(2000).nullable(),
});

export const gigSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(2000),
  price: z.number().int().min(500).max(100_000_000),
  deliveryDays: z.number().int().min(1).max(365),
  revisions: z.number().int().min(0).max(20),
  isActive: z.boolean(),
});
