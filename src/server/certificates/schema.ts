/**
 * What a host may save as certificate settings.
 *
 * Every limit here is about the printed page, not the database: a title longer
 * than ~40 characters cannot be set at a readable size on an A5 sheet, and a
 * paragraph past ~900 characters shrinks to a size nobody can read.
 */
import { z } from 'zod';

import { isAllowedCertificateImageUrl } from './images';
import type { CertificateSettings } from './types';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #rrggbb');

/**
 * A signature image must have been uploaded through the platform. The renderer
 * would refuse anything else at print time anyway (see ./images.ts); refusing
 * it here too means the host learns at save time, not when the line comes out
 * blank.
 */
const signatureImage = z.string().trim().max(500)
  .refine((u) => isAllowedCertificateImageUrl(u), {
    message: 'La signature doit être importée ou dessinée sur Metwork',
  })
  .nullable()
  .optional();

export const certificateSettingsSchema = z.object({
  template: z.enum(['VAGUES', 'DIAGONALES', 'CADRE', 'LATERAL']),
  font: z.enum(['MONTSERRAT', 'POPPINS', 'LATO', 'SPECTRAL', 'CORMORANT']),
  pageSize: z.enum(['A5', 'A4']),
  primaryColor: hex,
  darkColor: hex,
  title: z.string().trim().min(1).max(40),
  subtitle: z.string().trim().max(40),
  intro: z.string().trim().max(120),
  body: z.string().trim().min(1).max(900),
  trainerName: z.string().trim().max(120).nullable().optional(),
  hours: z.string().trim().max(40).nullable().optional(),
  signatories: z.array(z.object({
    name: z.string().trim().max(80),
    role: z.string().trim().max(60),
    imageUrl: signatureImage,
  })).min(1).max(2),
  showStamp: z.boolean(),
  showVerification: z.boolean(),
}) satisfies z.ZodType<CertificateSettings>;
