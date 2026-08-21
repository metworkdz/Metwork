/**
 * POST /api/metworkcrm/upload
 *
 * Dev rules R-26: a dedicated CRM upload endpoint, NOT a reuse of the
 * platform's `/api/upload` (images-only, 5 MB, requires a *customer*
 * session — unusable here). internal_users session only. Accepts
 * multipart/form-data with a `file` field, returns
 * `{ url, fileName, mimeType, sizeBytes, cloudinaryPublicId }` for the
 * client to hand straight to `POST /api/metworkcrm/documents`.
 */
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { json, jsonError } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { isConfigured, uploadBuffer } from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES: Record<string, 'image' | 'raw'> = {
  'application/pdf': 'raw',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'raw',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'raw',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'raw',
  'image/png': 'image',
  'image/jpeg': 'image',
};

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  if (!isConfigured()) {
    return jsonError(503, 'CRM_UPLOAD_UNAVAILABLE', 'Le stockage de documents n’est pas configuré sur cet environnement.');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'INVALID_FORM', 'Formulaire multipart/form-data attendu.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'Aucun fichier reçu (champ "file").');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'Le fichier est vide.');
  if (file.size > MAX_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'Fichier trop volumineux (20 Mo max).');

  // Server-side enforcement, not just the <input accept> attribute — a client
  // can send any Content-Type it wants.
  const resourceType = ALLOWED_MIME_TYPES[file.type];
  if (!resourceType) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Formats acceptés : PDF, Word, Excel, PowerPoint, PNG, JPG.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const publicId = randomUUID();

  try {
    const url = await uploadBuffer(buffer, { folder: 'metwork/crm-documents', publicId, resourceType });
    return json(
      { url, fileName: file.name, mimeType: file.type, sizeBytes: file.size, cloudinaryPublicId: publicId },
      { status: 201 },
    );
  } catch (err) {
    console.error('[metworkcrm/upload] Cloudinary error:', err);
    return jsonError(500, 'CRM_UPLOAD_FAILED', 'Échec du téléversement.');
  }
}
