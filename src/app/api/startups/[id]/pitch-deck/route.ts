/**
 * POST /api/startups/:id/pitch-deck — founder self-service pitch deck upload.
 *
 * Two request shapes, one persistence path:
 *
 *   application/json  { publicId }   — step 2 of the direct upload. The browser
 *     already POSTed the file to Cloudinary using a signature from
 *     ./signature; we verify the asset, then save its URL.
 *
 *   multipart/form-data  file        — dev fallback only, taken when Cloudinary
 *     is not configured. Writes to public/uploads. NOT used on Vercel (where
 *     Cloudinary is configured), because the platform caps request bodies at
 *     4.5 MB — that cap is exactly why the direct path exists.
 *
 * Guarded by session + listing ownership (same founder-only check as
 * PATCH /api/startups/:id).
 *
 * Non-blocking rule: a failed upload returns an error and touches nothing —
 * the rest of the startup profile is saved independently via PATCH.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById } from '@/server/startups/service';
import { isPitchDeckPublicId, isPitchDeckDeliveryUrl } from '@/server/startups/pitch-deck';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import {
  isConfigured,
  isSupportedDocumentMime,
  uploadBuffer,
  getRawResource,
  destroyRawResource,
} from '@/lib/cloudinary';
import {
  MAX_PITCH_DECK_BYTES,
  MAX_PITCH_DECK_MB,
  PITCH_DECK_FOLDER,
} from '@/lib/upload-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const listing = await findStartupById(id);
  if (!listing) return jsonError(404, 'NOT_FOUND', 'Startup not found');
  if (listing.founderId !== guard.user.id) return jsonError(403, 'FORBIDDEN', 'Not your startup');

  const contentType = req.headers.get('content-type') ?? '';
  const url = contentType.includes('application/json')
    ? await confirmDirectUpload(req)
    : await receiveMultipart(req);

  if (typeof url !== 'string') return url; // an error response
  return persist(id, url);
}

/** Step 2 of the direct upload: verify what actually landed in Cloudinary. */
async function confirmDirectUpload(req: NextRequest): Promise<string | Response> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Expected a JSON body');
  }
  const { publicId, secureUrl } = (body ?? {}) as { publicId?: unknown; secureUrl?: unknown };
  if (typeof publicId !== 'string' || !publicId || typeof secureUrl !== 'string' || !secureUrl) {
    return jsonError(400, 'PUBLIC_ID_REQUIRED', 'Missing uploaded file reference');
  }
  // Both halves are pinned to values only this server could have produced: the
  // id must be one we minted, and the URL must be that exact asset on our own
  // cloud. A client can never point its listing at another asset in the account.
  if (!isPitchDeckPublicId(publicId) || !isPitchDeckDeliveryUrl(secureUrl, publicId)) {
    return jsonError(400, 'INVALID_PUBLIC_ID', 'Invalid uploaded file reference');
  }

  // Size enforcement against Cloudinary's own byte count — the browser's
  // reported size (checked when the signature was minted) is not trustworthy
  // on its own. A lookup failure must not cost the founder an upload that
  // already succeeded, so it is logged and the verified URL still accepted.
  try {
    const resource = await getRawResource(publicId);
    if (!resource) {
      console.error('[startups/pitch-deck] Confirmed upload not found in Cloudinary:', publicId);
      return jsonError(404, 'UPLOAD_NOT_FOUND', 'The uploaded file could not be found. Please try again.');
    }
    if (resource.bytes > MAX_PITCH_DECK_BYTES) {
      try { await destroyRawResource(publicId); } catch (err) {
        console.error('[startups/pitch-deck] Failed to clean up oversize upload:', err);
      }
      return jsonError(413, 'FILE_TOO_LARGE', `File exceeds the ${MAX_PITCH_DECK_MB} MB limit.`);
    }
  } catch (err) {
    console.error('[startups/pitch-deck] Cloudinary lookup failed, accepting verified URL:', err);
  }

  return secureUrl;
}

/** Dev fallback: Cloudinary unconfigured, so take the bytes and write to disk. */
async function receiveMultipart(req: NextRequest): Promise<string | Response> {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart/form-data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'File is empty');
  if (file.size > MAX_PITCH_DECK_BYTES) {
    return jsonError(413, 'FILE_TOO_LARGE', `File exceeds the ${MAX_PITCH_DECK_MB} MB limit.`);
  }
  if (!isSupportedDocumentMime(file.type)) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Pitch deck must be a PDF file.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (isConfigured()) {
    // Reachable only if a client posts multipart despite the signature route
    // offering the direct path. Same canonical helper, same folder.
    try {
      return await uploadBuffer(buffer, { folder: PITCH_DECK_FOLDER, resourceType: 'raw' });
    } catch (err) {
      console.error('[startups/pitch-deck] Cloudinary error:', err);
      return jsonError(503, 'UPLOAD_UNAVAILABLE', 'The upload service is unavailable. Please try again later.');
    }
  }

  const filename = `${randomUUID()}.pdf`;
  const dir = path.join(process.cwd(), 'public', 'uploads', 'pitch-decks');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
  } catch (err) {
    console.error('[startups/pitch-deck] Filesystem fallback error:', err);
    return jsonError(500, 'UPLOAD_FAILED', 'File write failed. Configure CLOUDINARY_* env vars for production.');
  }
  return `/uploads/pitch-decks/${filename}`;
}

/** Persist onto the listing — only ever after a successful upload. */
async function persist(id: string, url: string): Promise<Response> {
  await db.update((d) => {
    const record = d.startupListings.find((l) => l.id === id);
    if (!record) return;
    record.pitchDeckUrl = url;
    record.updatedAt = new Date().toISOString();
  });

  return json({ url }, { status: 201 });
}
