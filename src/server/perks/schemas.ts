/**
 * Zod input schemas for the Partner Perks feature.
 * Single source of input validation — imported by both admin and user routes.
 */
import { z } from 'zod';

export const createPerkSchema = z.object({
  partnerName: z.string().min(2).max(120),
  logoUrl: z.string().url().nullable().default(null),
  title: z.string().min(2).max(160),
  description: z.string().min(1).max(2000),
  fulfillmentType: z.enum(['CODE_POOL', 'VOUCHER']),
  minTier: z.enum(['BUILDER', 'FOUNDER']).default('BUILDER'),
  /** CODE_POOL only — validated against fulfillmentType in the service. */
  lowStockThreshold: z.number().int().min(1).max(10_000).nullable().default(null),
  active: z.boolean().default(true),
});
export type CreatePerkInput = z.infer<typeof createPerkSchema>;

export const patchPerkSchema = z.object({
  partnerName: z.string().min(2).max(120).optional(),
  logoUrl: z.string().url().nullable().optional(),
  title: z.string().min(2).max(160).optional(),
  description: z.string().min(1).max(2000).optional(),
  minTier: z.enum(['BUILDER', 'FOUNDER']).optional(),
  lowStockThreshold: z.number().int().min(1).max(10_000).nullable().optional(),
  active: z.boolean().optional(),
});
export type PatchPerkInput = z.infer<typeof patchPerkSchema>;

/**
 * Bulk-add pool codes: one code per line. Blank lines are skipped in the
 * service; per-code shape is validated there too (after splitting).
 */
export const addCodesSchema = z.object({
  codes: z.string().min(1).max(200_000),
});
export type AddCodesInput = z.infer<typeof addCodesSchema>;
