import { z } from 'zod';

export const createStartupSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().min(10).max(2000),
  industry: z.string().min(2).max(100),
  /** Integer DZD, minimum 100 000 DZD */
  fundingGoal: z.number().int().min(100_000),
  /** Percentage: 0.1 – 100 */
  equityOffered: z.number().min(0.1).max(100),
  /** Optional pre-money valuation in integer DZD */
  valuation: z.number().int().positive().optional().nullable(),
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;
