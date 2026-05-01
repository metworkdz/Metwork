import { z } from 'zod';
import { SIGNUP_ROLES } from '@/types/auth';

/**
 * Algerian phone numbers:
 * +213 followed by 9 digits, or 0 followed by 9 digits.
 * Accepts spaces, dashes, parentheses for formatting.
 */
export const algerianPhoneRegex = /^(\+213|0)(\s?[5-7])(\s?\d){8}$/;

/**
 * Strong password policy:
 * - 8+ chars
 * - At least one letter
 * - At least one number
 */
export const strongPasswordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const emailSchema = z.string().email();
export const phoneSchema = z
  .string()
  .min(1)
  .regex(algerianPhoneRegex, { message: 'invalidPhone' });
export const passwordSchema = z
  .string()
  .min(8, { message: 'weakPassword' })
  .regex(strongPasswordRegex, { message: 'weakPassword' });

/**
 * Login schema.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'required' }),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Signup — role selection step.
 */
export const signupRoleSchema = z.object({
  role: z.enum(SIGNUP_ROLES),
});
export type SignupRoleInput = z.infer<typeof signupRoleSchema>;

/**
 * Signup — full form schema.
 * Validation messages are i18n keys, resolved by the form via `t(message)`.
 */
export const signupSchema = z
  .object({
    role: z.enum(SIGNUP_ROLES),
    fullName: z
      .string()
      .min(2, { message: 'required' })
      .max(120, { message: 'required' }),
    email: emailSchema,
    phone: phoneSchema,
    city: z.string().min(1, { message: 'required' }),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'termsRequired' }),
    }),
    /** Explicit data-processing consent — required by Law 18-07 Art. 14. */
    acceptPrivacy: z.literal(true, {
      errorMap: () => ({ message: 'privacyRequired' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordMismatch',
  });
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * OTP verification schema.
 */
export const otpSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, { message: 'invalidOtp' }),
});
export type OtpInput = z.infer<typeof otpSchema>;

/**
 * Forgot password schema.
 */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
