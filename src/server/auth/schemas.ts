/**
 * Server-only zod schemas for endpoints whose request bodies aren't
 * already covered by `@/lib/validators`. Kept separate so the shared
 * client validators remain a clean source of truth for form schemas.
 */
import { z } from 'zod';
import { otpSchema, emailSchema } from '@/lib/validators';

export const verifyOtpRequestSchema = otpSchema.extend({
  userId: z.string().min(1),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const resendOtpRequestSchema = z.object({
  userId: z.string().min(1),
});
export type ResendOtpRequest = z.infer<typeof resendOtpRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z
  .object({
    token: z.string().min(1),
    password: z
      .string()
      .min(8, { message: 'weakPassword' })
      .regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, { message: 'weakPassword' }),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordMismatch',
  });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
