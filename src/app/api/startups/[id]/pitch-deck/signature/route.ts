/**
 * POST /api/startups/:id/pitch-deck/signature — step 1 of the pitch deck upload.
 *
 * JSON body: { size: number, mimeType: string }
 *
 * Returns either
 *   { mode: 'direct', uploadUrl, apiKey, timestamp, publicId, signature }
 *     → the browser POSTs the file straight to Cloudinary, then confirms with
 *       POST /api/startups/:id/pitch-deck { publicId }.
 *   { mode: 'proxy' }
 *     → Cloudinary isn't configured (local dev); the browser falls back to the
 *       multipart POST on /api/startups/:id/pitch-deck, which writes to disk.
 *
 * Why a signature at all: Vercel Functions reject request bodies over 4.5 MB
 * (not configurable) and tear the connection down mid-upload, which the browser
 * reports as a bare "Failed to fetch". Routing the bytes around the function is
 * the only way a 10 MB deck can land. See src/lib/cloudinary.ts#signRawUpload.
 *
 * Same guards as the upload itself: session + listing ownership. Minting a
 * signature creates nothing and touches no listing state.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById } from '@/server/startups/service';
import { buildPitchDeckPublicId } from '@/server/startups/pitch-deck';
import { json, jsonError, fromZod } from '@/server/http/json';
import { isConfigured, signRawUpload } from '@/lib/cloudinary';
import { MAX_PITCH_DECK_BYTES, MAX_PITCH_DECK_MB, PITCH_DECK_MIME } from '@/lib/upload-limits';
import { checkRateLimitDistributed } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  size:     z.number().int().positive(),
  mimeType: z.string().min(1),
});

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

  // 20 signatures per founder per hour. A signature is a licence to write into
  // our Cloudinary account, so it is rate limited independently of the image
  // upload route's own budget.
  if (!(await checkRateLimitDistributed(`pitch-deck:sign:${guard.user.id}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many upload attempts. Please wait a few minutes.');
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Expected a JSON body');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fromZod(parsed.error);

  // Reject before the browser wastes bandwidth. The true size is re-checked
  // server-side on confirm, against Cloudinary's own byte count.
  if (parsed.data.mimeType !== PITCH_DECK_MIME) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Pitch deck must be a PDF file.');
  }
  if (parsed.data.size > MAX_PITCH_DECK_BYTES) {
    return jsonError(413, 'FILE_TOO_LARGE', `File exceeds the ${MAX_PITCH_DECK_MB} MB limit.`);
  }

  if (!isConfigured()) return json({ mode: 'proxy' as const });

  try {
    const signed = signRawUpload(buildPitchDeckPublicId());
    return json({
      mode:      'direct' as const,
      uploadUrl: signed.uploadUrl,
      apiKey:    signed.apiKey,
      timestamp: signed.timestamp,
      publicId:  signed.publicId,
      signature: signed.signature,
    });
  } catch (err) {
    console.error('[startups/pitch-deck/signature] Failed to sign upload:', err);
    return jsonError(503, 'UPLOAD_UNAVAILABLE', 'The upload service is unavailable. Please try again later.');
  }
}
