import { z } from 'zod';

export const maturityStageSchema = z.enum([
  'IDEA',
  'PROTOTYPE_MVP',
  'PRE_SEED',
  'SEED',
  'SERIES_A',
  'GROWTH',
]);

/**
 * POST /api/startups/logo returns an absolute Cloudinary URL when configured,
 * but a relative `/uploads/...` path from the local-disk fallback otherwise
 * (dev/e2e without CLOUDINARY_* set) — accept either, unlike a plain `.url()`
 * which rejects the relative form.
 */
export const logoUrlSchema = z
  .string()
  .max(500)
  .refine((v) => /^https?:\/\//.test(v) || v.startsWith('/'), { message: 'Invalid logo URL' })
  .optional()
  .nullable();

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
  /** No default — the founder must actively choose a stage. */
  maturityStage: maturityStageSchema,
  /** Optional public website. */
  websiteUrl: z.string().url().max(300).optional().nullable(),
  /** Optional logo — uploaded via POST /api/startups/logo, URL persisted here. */
  logoUrl: logoUrlSchema,
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;
