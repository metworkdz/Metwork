/**
 * Storage and integrity for signed contract PDFs.
 *
 * Two properties matter here, and they are separate:
 *
 *  • INTEGRITY — the SHA-256 is computed over the exact bytes that are
 *    uploaded, before they leave this process. Re-downloading the asset later
 *    and re-hashing it must reproduce the stored digest; if it does not, the
 *    document has been altered and the contract is no longer evidence of
 *    anything.
 *
 *  • CONFIDENTIALITY — a signed contract carries the consultant's phone number,
 *    bank details and handwritten signature. It is stored as a Cloudinary
 *    `authenticated` raw asset and only ever reached through a short-lived
 *    signed link.
 *
 * NO PUBLIC-DISK FALLBACK. The other upload routes in this codebase fall back
 * to `public/uploads/` when Cloudinary is unconfigured, which is fine for an
 * avatar and unacceptable here: that directory is served publicly, so the
 * fallback would publish exactly the document the authenticated upload exists
 * to protect. This module fails closed instead — an unconfigured environment
 * cannot sign contracts, which is the safe direction to fail in.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  isConfigured,
  signedRawDownloadUrl,
  uploadAuthenticatedRaw,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/cloudinary';

/** Cloudinary folder holding every signed consultant contract. */
export const CONTRACT_FOLDER = 'metwork/consultant-contracts';

/** Lowercase hex SHA-256 of a buffer. */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Mint the public_id for one signing attempt.
 *
 * Carries a random suffix rather than being derived from the contract id alone:
 * uploads use `overwrite: false`, so a retry after a partial failure must land
 * on a fresh id instead of colliding with a half-written asset.
 *
 * Extensionless, matching every other raw upload in this codebase — see the
 * naming note in `src/lib/cloudinary.ts`.
 */
export function buildContractPublicId(contractId: string): string {
  return `${CONTRACT_FOLDER}/contract-${contractId}-${randomUUID()}`;
}

export interface StoredContractPdf {
  publicId: string;
  /** SHA-256 of the uploaded bytes. */
  hash: string;
  /** Signed link, already expiring — re-mint with `mintContractPdfUrl`. */
  url: string;
  bytes: number;
}

export class ContractStorageUnconfiguredError extends Error {
  constructor() {
    super('Cloudinary is not configured; refusing to store a signed contract.');
    this.name = 'ContractStorageUnconfiguredError';
  }
}

/**
 * Hash, then upload, then mint a first link.
 *
 * Hashing happens first and locally so the digest attests to what we produced,
 * not to whatever a later read of the remote asset returns.
 */
export async function storeSignedContractPdf(
  pdf: Buffer,
  contractId: string,
): Promise<StoredContractPdf> {
  if (!isConfigured()) throw new ContractStorageUnconfiguredError();

  const hash = sha256Hex(pdf);
  const publicId = buildContractPublicId(contractId);

  const uploaded = await uploadAuthenticatedRaw(pdf, { publicId });

  return {
    // Trust Cloudinary's echoed id over our own: it is what the asset is
    // actually filed under, and any normalisation it applied belongs in the DB.
    publicId: uploaded.publicId || publicId,
    hash,
    url: signedRawDownloadUrl(uploaded.publicId || publicId),
    bytes: uploaded.bytes,
  };
}

/**
 * Re-mint an expiring link for an already-stored contract. Called whenever an
 * admin or consultant opens one, since the stored URL will usually have lapsed.
 */
export function mintContractPdfUrl(publicId: string, expiresInSeconds?: number): string {
  return signedRawDownloadUrl(publicId, { expiresInSeconds });
}

export { SIGNED_URL_TTL_SECONDS };

/**
 * Fetch a stored contract's bytes, server-side, using a freshly-minted signed
 * link.
 *
 * Exists because handing the Cloudinary link to the browser DOES NOT WORK for
 * a document the user is meant to read. That endpoint answers with
 * `Content-Type: application/octet-stream` and
 * `Content-Disposition: attachment`, and the filename it derives from our
 * extensionless public_id has no `.pdf` — so `window.open()` yields a blank tab
 * plus a download the OS cannot open by double-click. Verified against the live
 * asset, not assumed.
 *
 * Serving the bytes ourselves lets the route set a real `application/pdf`
 * content type and an inline disposition, which is what actually renders. The
 * asset stays `authenticated` on Cloudinary; only this server can mint the link.
 *
 * Returns null when the link cannot be fetched, so a caller can answer 404
 * rather than stream an HTML error page as if it were a PDF.
 */
export async function fetchContractPdfBytes(publicId: string): Promise<Buffer | null> {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(signedRawDownloadUrl(publicId), { redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // A signed-link failure can still answer 200 with an HTML/JSON error body.
    // Only real PDF bytes may reach a caller that will label them application/pdf.
    return buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null;
  } catch {
    return null;
  }
}
