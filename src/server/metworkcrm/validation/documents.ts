/**
 * METWORK OS CRM — Document validation: attach a file already uploaded via
 * `POST /api/metworkcrm/upload` (dev rules R-26) to one entity, plus the
 * query schemas for the per-entity list and the cross-entity browse page
 * (`/metworkcrm/documents`, Prompt 5).
 */
import { z } from 'zod';
import { DOCUMENT_ENTITY_TYPES, DOCUMENT_TYPES } from '../db/schema';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalTrimmed = z.preprocess(emptyToUndefined, z.string().trim().optional());

export const documentAttachSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est requis.').max(200),
  type: z.enum(DOCUMENT_TYPES, { errorMap: () => ({ message: 'Type invalide.' }) }),
  entityType: z.enum(DOCUMENT_ENTITY_TYPES, { errorMap: () => ({ message: 'Type de fiche invalide.' }) }),
  entityId: z.string().trim().min(1),
  fileUrl: z.string().trim().url('URL de fichier invalide.'),
  fileName: optionalTrimmed,
  mimeType: optionalTrimmed,
  sizeBytes: z.coerce.number().int().min(0).optional(),
  cloudinaryPublicId: optionalTrimmed,
});

export type DocumentAttachInput = z.infer<typeof documentAttachSchema>;

export const documentListQuerySchema = z.object({
  entityType: z.enum(DOCUMENT_ENTITY_TYPES),
  entityId: z.string().trim().min(1),
});

export const documentBrowseQuerySchema = z.object({
  q: optionalTrimmed,
  type: z.enum(DOCUMENT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
