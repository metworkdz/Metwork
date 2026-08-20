/**
 * METWORK OS CRM — auth input validation.
 * French messages: the CRM UI is French-only, no next-intl (dev rules R-5).
 */
import { z } from 'zod';

export const crmLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.'),
  password: z.string().min(1, 'Mot de passe requis.'),
});

export type CrmLoginInput = z.infer<typeof crmLoginSchema>;

/**
 * Minimum 8 characters for a *chosen* password. The seeded initial credential
 * is deliberately shorter and is exactly what `mustChangePassword` exists to
 * force out — so this rule applies to the new password, never the current one.
 */
export const crmChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis.'),
    newPassword: z
      .string()
      .min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères.')
      .max(200, 'Mot de passe trop long.'),
    confirmPassword: z.string().min(1, 'Confirmation requise.'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Les mots de passe ne correspondent pas.',
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ['newPassword'],
    message: 'Le nouveau mot de passe doit être différent de l’actuel.',
  });

export type CrmChangePasswordInput = z.infer<typeof crmChangePasswordSchema>;
