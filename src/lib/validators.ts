import { z } from 'zod';
import { SIGNUP_ROLES, INCUBATOR_BUSINESS_TYPES } from '@/types/auth';

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

/**
 * Treat an empty / whitespace-only string as "not provided" so optional
 * URL/handle fields don't fail validation when the user leaves them blank.
 */
const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/** Optional website — must be a valid URL when present. */
export const optionalUrlSchema = z.preprocess(
  emptyToUndefined,
  z.string().url({ message: 'invalidUrl' }).max(200).optional(),
);

/** Optional social handle or URL (Instagram / LinkedIn). Free text, capped. */
export const optionalHandleSchema = z.preprocess(
  emptyToUndefined,
  z.string().max(200).optional(),
);
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
    /**
     * `z.boolean().refine()` rather than `z.literal(true, { errorMap })`: a
     * failed `z.literal` produces Zod's "aborted" parse status (not "dirty"),
     * which silently skips every `.refine()` chained after this object —
     * including the password-match check below and the businessType check
     * further down. Since these two checkboxes are unchecked by default,
     * that abort fired on essentially every first submit attempt. `.refine()`
     * doesn't have this failure mode.
     */
    acceptTerms: z.boolean().refine((v) => v === true, { message: 'termsRequired' }),
    /** Explicit data-processing consent — required by Law 18-07 Art. 14. */
    acceptPrivacy: z.boolean().refine((v) => v === true, { message: 'privacyRequired' }),
    /** Optional — only shown when role === 'INCUBATOR'. */
    incubatorName: z.string().max(100).optional(),
    /** Optional — incubator website (role === 'INCUBATOR'). URL-validated. */
    website: optionalUrlSchema,
    /** Optional — incubator Instagram handle or URL (role === 'INCUBATOR'). */
    instagram: optionalHandleSchema,
    /** Optional (recommended) — investor LinkedIn handle or URL (role === 'INVESTOR'). */
    linkedin: optionalHandleSchema,
    /** Biological sex — shown for ENTREPRENEUR and INVESTOR roles. */
    sex: z.enum(['MALE', 'FEMALE']).optional(),

    /**
     * Organisation kind — shown for INCUBATOR only. Required at signup (enforced
     * by the refine below); still purely informational once stored — it grants
     * no extra capability. The underlying `IncubatorRecord.businessType` field
     * itself stays nullable, since accounts created before this requirement
     * (or via the settings page, where it remains optional) may still lack it.
     */
    businessType: z.enum(INCUBATOR_BUSINESS_TYPES).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordMismatch',
  })
  .refine((data) => data.role !== 'INCUBATOR' || !!data.businessType, {
    path: ['businessType'],
    message: 'businessTypeRequired',
  });
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Incubator name — optional extra field shown only when role === 'INCUBATOR'.
 * Kept separate so it doesn't pollute the base schema refinement chain.
 */
export const incubatorNameSchema = z
  .string()
  .min(2, { message: 'required' })
  .max(100)
  .optional();

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
