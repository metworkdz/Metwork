/**
 * Fetching the images a PDF is drawn with — logos, stamps, signatures — from
 * URLs a host controls.
 *
 * Every one of these URLs is typed or uploaded by someone other than us (an
 * incubator's profile, a consultant's photo, the admin stamp), and the server
 * fetches it. An unrestricted fetch is a server-side request to wherever that
 * person points it — internal services, cloud metadata, other people's assets
 * — with no ceiling on what comes back. So every PDF image goes through this
 * one narrow door:
 *
 *   • https only, and only our own Cloudinary account — every logo, stamp and
 *     signature is uploaded through the platform's upload routes, which land
 *     there, so nothing legitimate is refused;
 *   • no redirects, so an allowed URL cannot bounce the request elsewhere;
 *   • a hard size cap, enforced while reading rather than trusted from a
 *     header;
 *   • a timeout.
 *
 * An inline `data:image/png|jpeg;base64,…` URI is also accepted: it makes no
 * request at all, only decodes bytes already in memory, under the same cap.
 *
 * Anything refused, or any failure, comes back as null — every renderer
 * already treats that as "no image" and draws the document without it.
 */

/** Big enough for a scanned stamp, small enough that nobody fills memory. */
export const MAX_PDF_IMAGE_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 5000;

const DATA_IMAGE = /^data:image\/(?:png|jpe?g);base64,/i;

/**
 * Is this URL somewhere a PDF image may be fetched from?
 *
 * With CLOUDINARY_CLOUD_NAME set, the path must also be under that account —
 * a bare res.cloudinary.com host would still admit images hosted on anyone's
 * account. (Uploads require that variable, so it is set wherever uploads work.)
 *
 * Network URLs only: an inline data URI is not "allowed" here, so a profile
 * field validated with this cannot store a multi-megabyte blob.
 */
export function isAllowedPdfImageUrl(raw: string, cloudName = process.env.CLOUDINARY_CLOUD_NAME): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.hostname !== 'res.cloudinary.com') return false;
  if (url.username || url.password) return false;
  if (cloudName && !url.pathname.startsWith(`/${cloudName}/`)) return false;
  return true;
}

function decodeDataImage(raw: string): Buffer | null {
  const comma = raw.indexOf(',');
  // base64 is 4 chars per 3 bytes: refuse before decoding anything oversized.
  if ((raw.length - comma - 1) * 0.75 > MAX_PDF_IMAGE_BYTES) return null;
  const buf = Buffer.from(raw.slice(comma + 1), 'base64');
  return buf.length > 0 ? buf : null;
}

export async function fetchPdfImage(raw: string | null | undefined): Promise<Buffer | null> {
  if (!raw) return null;
  if (DATA_IMAGE.test(raw)) return decodeDataImage(raw);
  if (!isAllowedPdfImageUrl(raw)) return null;
  try {
    const res = await fetch(raw, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    if (!res.ok || !res.body) return null;

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_PDF_IMAGE_BYTES) {
      await res.body.cancel();
      return null;
    }

    // Count while reading: a missing or lying Content-Length must not let a
    // response grow past the cap.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return total > 0 ? Buffer.concat(chunks) : null;
  } catch {
    return null;
  }
}
