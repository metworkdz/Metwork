/**
 * POST /api/registrations/file-upload — DEV-ONLY upload fallback.
 *
 * multipart/form-data: entityType, entityId, fieldId, file
 *
 * Used only when Cloudinary is not configured and the app is not running in
 * production (see `registrationFileStorageMode`). Writes to the git-ignored
 * `.local-uploads/` folder so the feature can be built and tested without
 * credentials. Everywhere else it answers 404: real uploads go browser →
 * Cloudinary and never pass through a serverless function.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { MAX_REGISTRATION_FILE_BYTES, MAX_REGISTRATION_FILE_MB } from '@/lib/upload-limits';
import { registrationFileStorageMode, writeLocalRegistrationFile } from '@/server/registrations/file-storage';
import {
  buildRegistrationFilePublicId,
  findUploadTarget,
  sniffRegistrationFile,
} from '@/server/registrations/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fieldsSchema = z.object({
  entityType: z.enum(['PROGRAM', 'EVENT']),
  entityId:   z.string().uuid(),
  fieldId:    z.string().uuid(),
});

export async function POST(req: NextRequest) {
  if (registrationFileStorageMode() !== 'local') {
    return jsonError(404, 'NOT_FOUND', 'Not found');
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await checkRateLimitDistributed(`reg-file:ip:${ip}`, 40, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many upload attempts. Please try again later.');
  }

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart/form-data');
  }
  const parsed = fieldsSchema.safeParse({
    entityType: form.get('entityType'),
    entityId:   form.get('entityId'),
    fieldId:    form.get('fieldId'),
  });
  if (!parsed.success) return fromZod(parsed.error);
  const { entityType, entityId, fieldId } = parsed.data;

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'No file under field "file"');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'File is empty');
  if (file.size > MAX_REGISTRATION_FILE_BYTES) {
    return jsonError(413, 'FILE_TOO_LARGE', `File exceeds the ${MAX_REGISTRATION_FILE_MB} MB limit.`);
  }

  const target = findUploadTarget(await db.read(), entityType, entityId, fieldId);
  if (!target.ok) return jsonError(404, 'NOT_FOUND', 'This form does not accept a file here.');

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffRegistrationFile(buffer.subarray(0, 8))) {
    return jsonError(415, 'UNSUPPORTED_FILE_TYPE', 'The file must be a PDF or a JPG.');
  }

  const publicId = buildRegistrationFilePublicId(entityType, entityId, fieldId);
  try {
    await writeLocalRegistrationFile(publicId, buffer);
  } catch (err) {
    console.error('[registrations/file-upload] Local write failed:', err);
    return jsonError(500, 'UPLOAD_FAILED', 'File write failed.');
  }
  return json({ publicId }, { status: 201 });
}
