/**
 * Zod input schemas for admin-managed mentor categories.
 * Single source of input validation — imported by the admin CRUD routes.
 */
import { z } from 'zod';

const labelSchema = z.object({
  fr: z.string().min(1).max(80),
  en: z.string().min(1).max(80),
  ar: z.string().min(1).max(80),
});

export const createMentorCategorySchema = z.object({
  label: labelSchema,
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  active: z.boolean().optional().default(true),
});
export type CreateMentorCategoryInput = z.infer<typeof createMentorCategorySchema>;

/**
 * All fields optional; partial update semantics. `label`, when provided,
 * must still carry all three locales — there's no notion of patching a
 * single language in isolation.
 */
export const patchMentorCategorySchema = z.object({
  label: labelSchema.optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  active: z.boolean().optional(),
});
export type PatchMentorCategoryInput = z.infer<typeof patchMentorCategorySchema>;
