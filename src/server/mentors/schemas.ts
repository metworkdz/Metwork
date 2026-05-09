/**
 * Server-side request schemas for mentor admin endpoints. Reused on the
 * client by importing from `@/types/mentor` (the inferred type).
 */
import { z } from 'zod';

const urlOrPath = z.string().min(1).refine(
  (v) => /^(https?:\/\/|\/)/.test(v),
  { message: 'mustBeUrlOrAbsolutePath' },
);

export const createMentorSchema = z.object({
  fullName: z.string().min(2).max(120),
  position: z.string().min(2).max(160),
  imageUrl: urlOrPath,
  bio: z.string().max(2000).optional().nullable(),
  linkedinUrl: z.string().url().max(300).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  consultationFee: z.number().int().min(0).max(1_000_000).optional(),
});
export type CreateMentorInput = z.infer<typeof createMentorSchema>;

/** All fields optional; partial update semantics. */
export const updateMentorSchema = createMentorSchema.partial();
export type UpdateMentorInput = z.infer<typeof updateMentorSchema>;
