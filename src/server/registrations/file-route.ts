/**
 * Shared HTTP handler for "open the file a participant attached".
 *
 *   GET /api/incubator/registrations/:id/files/:fieldId[?download=1]
 *   GET /api/consultant/registrations/:id/files/:fieldId[?download=1]
 *
 * Two surfaces, one contract (like `list-route.ts`): the route files resolve
 * WHO is asking, this decides what they may see.
 *
 * Files are private to the owner of the listing and nobody else — not other
 * incubators, not other consultants, not an applicant's own link, not platform
 * staff acting without an owner profile. There is no public URL for a file;
 * this route is the only way to its bytes. A registration that is not the
 * caller's answers exactly like one that does not exist (404), so ids cannot be
 * probed.
 *
 * The bytes are streamed through here rather than redirecting to a signed
 * Cloudinary link, for two reasons the contract PDF route already learned:
 * Cloudinary's download endpoint answers `application/octet-stream` with a
 * filename derived from the storage id (so the file arrives named like a UUID),
 * and it can never render inline. Streaming lets us name the file after what the
 * applicant sent and show a PDF or JPG right in the browser tab.
 *
 * Content-Type comes from the type we MEASURED at submit time, never from the
 * upstream response, and `nosniff` stops a browser second-guessing it.
 */
import type { NextRequest } from 'next/server';
import { jsonError } from '@/server/http/json';
import { findOwnedRegistration, type OwnerScope } from '@/server/registrations/service';
import { openRegistrationFile } from '@/server/registrations/file-storage';
import { isRegistrationFilePublicId, sniffRegistrationFile } from '@/server/registrations/files';

/** RFC 5987 `filename*` plus an ASCII fallback, so Arabic and accented names survive. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function handleRegistrationFile(
  req: NextRequest,
  owner: OwnerScope,
  registrationId: string,
  fieldId: string,
) {
  const notFound = () => jsonError(404, 'NOT_FOUND', 'File not found');

  const registration = await findOwnedRegistration(registrationId, owner);
  if (!registration) return notFound();

  const answer = registration.answers.find((a) => a.fieldId === fieldId);
  const file = answer?.file;
  const publicId = typeof answer?.value === 'string' ? answer.value : '';
  if (!answer || !file || !publicId) return notFound();

  // The stored id must still be one minted for THIS question of THIS listing.
  // A record that somehow points elsewhere is never followed.
  if (!isRegistrationFilePublicId(publicId, registration.entityType, registration.entityId, fieldId)) {
    return notFound();
  }

  let opened;
  try {
    // The bytes must be what we verified at submit time, or we serve nothing.
    opened = await openRegistrationFile(publicId, (chunk) => sniffRegistrationFile(chunk) === file.contentType);
  } catch (err) {
    console.error('[registration-files] Could not open', publicId, err);
    return jsonError(503, 'STORAGE_UNAVAILABLE', 'File storage is unavailable. Please try again.');
  }
  if (!opened) return notFound();

  // What is stored must still be what was verified. The signature that let the
  // applicant upload stays valid for a while after they submit, so a file could
  // be replaced behind the registration; a different size is the cheap tell, on
  // top of the byte check above. (A header we cannot read is not held against it.)
  if (opened.bytes !== null && opened.bytes !== file.bytes) {
    await opened.body.cancel().catch(() => undefined);
    console.error('[registration-files] Stored size no longer matches the verified size', publicId);
    return notFound();
  }

  const download = new URL(req.url).searchParams.get('download') === '1';
  return new Response(opened.body, {
    headers: {
      'Content-Type': file.contentType,
      ...(opened.bytes ? { 'Content-Length': String(opened.bytes) } : {}),
      'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', file.name),
      'X-Content-Type-Options': 'nosniff',
      // A private applicant document: never kept by a shared cache or the CDN.
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
