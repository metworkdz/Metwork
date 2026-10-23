/**
 * POST /api/freelancer/legal-document — upload the auto-entrepreneur card or
 * commercial register extract (multipart: `status`, `kind`, `file`).
 *
 * Stored as a private Cloudinary asset, read by Claude, decided by rules (see
 * `@/server/freelancers/legal-review`). Responds with the review state:
 * APPROVED right away, or PENDING with the reasons it went to the admin queue.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { submitLegalDocument } from '@/server/freelancers/service';
import { isLegalStatus, LEGAL_DOCUMENT_KINDS, type LegalDocumentKind } from '@/types/legal-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Upload + a vision read.
export const maxDuration = 60;

/** Under Vercel's 4.5 MB request cap, with room for the multipart envelope. */
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** Magic bytes, so a renamed file can't pass as an image or PDF. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  // Each submission costs a vision call.
  if (!(await checkRateLimitDistributed(`legal-document:${guard.user.id}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many submissions. Please try again in an hour.');
  }

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart form data');
  }
  const status = form.get('status');
  const kind = form.get('kind');
  const file = form.get('file');
  if (typeof status !== 'string' || !isLegalStatus(status)) return jsonError(422, 'INVALID_STATUS', 'Unknown legal status');
  if (typeof kind !== 'string' || !(LEGAL_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    return jsonError(422, 'INVALID_KIND', 'Unknown document type');
  }
  if (!(file instanceof File)) return jsonError(422, 'FILE_REQUIRED', 'Attach the document');
  if (file.size > MAX_DOCUMENT_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'The file must be 4 MB or smaller');

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buffer);
  if (!mime || !ALLOWED_MIME.has(mime)) {
    return jsonError(415, 'UNSUPPORTED_FILE', 'Upload a JPG, PNG, WebP or PDF');
  }

  const result = await submitLegalDocument({
    userId: guard.user.id,
    status,
    kind: kind as LegalDocumentKind,
    buffer,
    mimeType: mime,
  });
  if (!result.ok) {
    if (result.reason === 'DOCUMENT_NOT_ACCEPTED') {
      return jsonError(422, 'DOCUMENT_NOT_ACCEPTED', 'This document does not match the legal status');
    }
    if (result.reason === 'STORAGE_UNAVAILABLE') {
      return jsonError(503, 'STORAGE_UNAVAILABLE', 'Document storage is not configured');
    }
    return jsonError(404, 'NOT_FOUND', 'User not found');
  }
  return json({ review: { state: result.decision.state, reasons: result.decision.reasons } }, { status: 201 });
}
