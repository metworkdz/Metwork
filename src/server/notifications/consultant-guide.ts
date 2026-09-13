/**
 * The consultant starter guide (PDF), attached to the welcome email.
 *
 * Stored on Cloudinary as an AUTHENTICATED raw asset and fetched server-side
 * with a freshly-minted signed link — the same path the signed contracts take,
 * and the only one verified to work against this account. A public `.pdf`
 * delivery URL returns 401 while the account's "Allow delivery of PDF and ZIP
 * files" setting is off, so a plain hosted link is not an option here.
 *
 * NOT bundled with the code. At ~4.3 MB it would be dead weight in every
 * lambda, and keeping it remote means the guide can be replaced without a
 * deploy: re-upload over the same public_id (see
 * `scripts/upload-consultant-guide.ts`) and the next email carries the new one.
 *
 * Cached in-process after the first fetch: every welcome email attaches the
 * same bytes, and a warm lambda should not re-download 4 MB per recipient.
 */
import { isConfigured, signedRawDownloadUrl } from '@/lib/cloudinary';

/** Cloudinary public_id of the guide. Extensionless, as every raw asset here is. */
export const CONSULTANT_GUIDE_PUBLIC_ID = 'metwork/guides/guide-consultant-metwork';

/** Filename the recipient sees in their mail client. */
export const CONSULTANT_GUIDE_FILENAME = 'Guide-consultant-Metwork.pdf';

let cached: Buffer | null | undefined;

/**
 * The guide's bytes, or null when it cannot be fetched.
 *
 * Null-safe on purpose: a welcome email that arrives without its attachment is
 * a much better outcome than one that never arrives because the CDN blinked.
 * The caller sends either way.
 */
export async function loadConsultantGuidePdf(): Promise<Buffer | null> {
  if (cached !== undefined) return cached;
  if (!isConfigured()) {
    cached = null;
    return cached;
  }
  try {
    const res = await fetch(signedRawDownloadUrl(CONSULTANT_GUIDE_PUBLIC_ID), {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      cached = null;
      return cached;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // A signed-link failure can still answer 200 with an HTML error body —
    // attaching that as "Guide-consultant-Metwork.pdf" would be worse than
    // attaching nothing.
    cached = buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Drop the cached copy — used after re-uploading the guide. */
export function clearConsultantGuideCache(): void {
  cached = undefined;
}
