import { z } from 'zod';
import { CONTACT_LANGUAGES, RECORD_STATUSES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalEmail = z.preprocess(
  emptyToUndefined,
  z.string().trim().toLowerCase().email('E-mail invalide.').optional(),
);
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url('URL invalide.').optional(),
);

/** One linked organization, as submitted from the org-linking editor. */
export const contactOrganizationLinkSchema = z.object({
  organizationId: z.string().min(1),
  role: optionalTrimmed,
  isPrimary: z.boolean().default(false),
});

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Le prénom est requis.').max(100),
  lastName: z.string().trim().min(1, 'Le nom est requis.').max(100),
  position: optionalTrimmed,
  email: optionalEmail,
  phone: optionalTrimmed,
  whatsapp: optionalTrimmed,
  linkedinUrl: optionalUrl,
  city: optionalTrimmed,
  language: z.enum(CONTACT_LANGUAGES).optional(),
  status: z.enum(RECORD_STATUSES).default('ACTIF'),
  source: optionalTrimmed,
  ownerId: optionalTrimmed,
  notes: optionalTrimmed,
  platformUserId: optionalTrimmed,
  platformMentorId: optionalTrimmed,
  /**
   * Optional at create time: the full desired set of organization links.
   * When present, exactly one entry may have `isPrimary: true` — enforced
   * below so the client can't submit two "primary" organizations.
   */
  organizations: z.array(contactOrganizationLinkSchema).max(20).optional(),
});

export const contactInputSchemaRefined = contactInputSchema.superRefine((data, ctx) => {
  const primaryCount = (data.organizations ?? []).filter((o) => o.isPrimary).length;
  if (primaryCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['organizations'],
      message: 'Une seule organisation peut être marquée comme principale.',
    });
  }
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactUpdateSchema = contactInputSchema.partial();

/** Body for PUT /contacts/:id/organizations — replaces the full link set. */
export const contactOrganizationsReplaceSchema = z
  .object({ organizations: z.array(contactOrganizationLinkSchema).max(20) })
  .superRefine((data, ctx) => {
    const primaryCount = data.organizations.filter((o) => o.isPrimary).length;
    if (primaryCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizations'],
        message: 'Une seule organisation peut être marquée comme principale.',
      });
    }
    const ids = data.organizations.map((o) => o.organizationId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizations'],
        message: 'Organisation en double.',
      });
    }
  });

export const contactListQuerySchema = z.object({
  q: optionalTrimmed,
  status: z.enum(RECORD_STATUSES).optional(),
  organizationId: optionalTrimmed,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
