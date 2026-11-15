/**
 * POST /api/registrations/file-signature — step 1 of attaching a file to a
 * registration answer.
 *
 * Public, like the registration it belongs to: most applicants are guests.
 *
 * JSON body: { entityType, entityId, fieldId, size, mimeType }
 *
 * Returns either
 *   { mode: 'direct', uploadUrl, apiKey, timestamp, publicId, signature, type }
 *     → the browser POSTs the file straight to Cloudinary as a PRIVATE asset
 *       (`type=authenticated` is part of what we signed), then submits the form
 *       with `publicId` as the answer.
 *   { mode: 'proxy' }
 *     → Cloudinary isn't configured (local dev only); the browser posts the file
 *       to /api/registrations/file-upload instead.
 *
 * A signature is a licence to write into our storage, so it is only issued for
 * a FILE question that exists on an active program/event, for the path of that
 * question alone, and under rate limits. The bytes are verified again, by what
 * they really are, when the form is submitted (see ../files.ts).
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { signRawUpload } from '@/lib/cloudinary';
import { MAX_REGISTRATION_FILE_BYTES, MAX_REGISTRATION_FILE_MB } from '@/lib/upload-limits';
import { registrationFileStorageMode } from '@/server/registrations/file-storage';
import {
  buildRegistrationFilePublicId,
  findUploadTarget,
  isAllowedRegistrationFileMime,
} from '@/server/registrations/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  entityType: z.enum(['PROGRAM', 'EVENT']),
  entityId:   z.string().uuid(),
  fieldId:    z.string().uuid(),
  size:       z.number().int().positive(),
  mimeType:   z.string().min(1),
});

export async function POST(req: NextRequest) {
  // Generous per IP: many applicants share one carrier NAT, and a cohort
  // registering from one WhatsApp announcement arrives together. The per-event
  // budget below is what bounds the total.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await checkRateLimitDistributed(`reg-file:ip:${ip}`, 40, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many upload attempts. Please try again later.');
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Expected a JSON body');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fromZod(parsed.error);
  const { entityType, entityId, fieldId, size, mimeType } = parsed.data;

  // Reject before the browser wastes bandwidth. The true type and size are
  // re-checked on submit, against what actually landed in storage.
  if (!isAllowedRegistrationFileMime(mimeType)) {
    return jsonError(415, 'UNSUPPORTED_FILE_TYPE', 'The file must be a PDF or a JPG.');
  }
  if (size > MAX_REGISTRATION_FILE_BYTES) {
    return jsonError(413, 'FILE_TOO_LARGE', `File exceeds the ${MAX_REGISTRATION_FILE_MB} MB limit.`);
  }

  const target = findUploadTarget(await db.read(), entityType, entityId, fieldId);
  if (!target.ok) return jsonError(404, 'NOT_FOUND', 'This form does not accept a file here.');

  if (!(await checkRateLimitDistributed(`reg-file:entity:${entityId}`, 300, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many uploads for this form. Please try again later.');
  }

  const mode = registrationFileStorageMode();
  if (mode === 'unavailable') {
    return jsonError(503, 'UPLOAD_UNAVAILABLE', 'The upload service is unavailable. Please try again later.');
  }
  if (mode === 'local') return json({ mode: 'proxy' as const });

  try {
    const signed = signRawUpload(buildRegistrationFilePublicId(entityType, entityId, fieldId), {
      type: 'authenticated',
    });
    return json({
      mode:      'direct' as const,
      uploadUrl: signed.uploadUrl,
      apiKey:    signed.apiKey,
      timestamp: signed.timestamp,
      publicId:  signed.publicId,
      signature: signed.signature,
      type:      signed.type,
    });
  } catch (err) {
    console.error('[registrations/file-signature] Failed to sign upload:', err);
    return jsonError(503, 'UPLOAD_UNAVAILABLE', 'The upload service is unavailable. Please try again later.');
  }
}
