/**
 * Fetching the images a certificate is drawn with — the logo, the stamp and
 * the signatures — from URLs a host controls.
 *
 * The shared `fetchImageBuffer` fetches ANY URL, whole, into memory. That is a
 * server-side request to wherever a host points it, with no ceiling on what
 * comes back. Invoices and receipts only ever use it for a logo and a stamp;
 * certificates add signature images, set by consultants as well as
 * incubators. So certificates go through this narrower door:
 *
 *   • https only, and only our own Cloudinary account — every signature and
 *     stamp is uploaded through the platform's upload routes, which land
 *     there, so nothing legitimate is refused;
 *   • a hard size cap, enforced while reading rather than trusted from a
 *     header;
 *   • a timeout.
 *
 * Anything refused comes back as null, which the renderer already treats as
 * "no image": the line stays blank to be signed by hand.
 */

/** Big enough for a scanned stamp, small enough that nobody fills memory. */
export const MAX_CERTIFICATE_IMAGE_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 5000;

/**
 * Is this URL somewhere a certificate image may come from?
 *
 * With CLOUDINARY_CLOUD_NAME set, the path must also be under that account —
 * a bare res.cloudinary.com host would still admit images hosted on anyone's
 * account.
 */
export function isAllowedCertificateImageUrl(raw: string, cloudName = process.env.CLOUDINARY_CLOUD_NAME): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.hostname !== 'res.cloudinary.com') return false;
  if (url.username || url.password) return false;
  if (cloudName && !url.pathname.startsWith(`/${cloudName}/`)) return false;
  return true;
}

export async function fetchCertificateImage(raw: string | null | undefined): Promise<Buffer | null> {
  if (!raw || !isAllowedCertificateImageUrl(raw)) return null;
  try {
    const res = await fetch(raw, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    if (!res.ok || !res.body) return null;

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_CERTIFICATE_IMAGE_BYTES) return null;

    // Count while reading: a missing or lying Content-Length must not let a
    // response grow past the cap.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CERTIFICATE_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
