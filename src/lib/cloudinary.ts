import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function isConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

export function isSupportedMime(type: string): boolean {
  return ALLOWED_TYPES.has(type);
}

/** Document types accepted for CV/resume uploads (consultant portal). */
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf']);

export function isSupportedDocumentMime(type: string): boolean {
  return ALLOWED_DOCUMENT_TYPES.has(type);
}

/**
 * Signed direct-to-Cloudinary upload (browser → Cloudinary, never through our
 * serverless function).
 *
 * Vercel Functions cap the REQUEST body at 4.5 MB and the limit is not
 * configurable (https://vercel.com/docs/functions/limitations). Anything larger
 * is killed mid-upload by the platform, which the browser surfaces as a bare
 * `TypeError: Failed to fetch` — no HTTP response ever reaches our code. Pitch
 * decks routinely exceed that, so they bypass the function entirely: we mint a
 * short-lived signature, the browser POSTs the file to Cloudinary, then hands
 * us back the public_id to persist.
 *
 * The signature covers `public_id` (and therefore the folder), so a tampered
 * public_id is rejected by Cloudinary with 401 "Invalid Signature" — the client
 * cannot redirect the upload anywhere we did not choose.
 */
export interface SignedUploadParams {
  cloudName: string;
  apiKey:    string;
  timestamp: number;
  publicId:  string;
  signature: string;
  /** Full endpoint the browser POSTs the multipart form to. */
  uploadUrl: string;
}

export function signRawUpload(publicId: string): SignedUploadParams {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey    = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;
  const timestamp = Math.round(Date.now() / 1000);

  // Only the params we sign may be sent by the browser — Cloudinary rebuilds
  // the string-to-sign from the received form fields and compares.
  const signature = cloudinary.utils.api_sign_request(
    { public_id: publicId, timestamp },
    apiSecret,
  );

  return {
    cloudName,
    apiKey,
    timestamp,
    publicId,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
  };
}

/**
 * Admin-API lookup for a `raw` asset. Used after a direct upload to confirm the
 * asset really exists and to read its TRUE byte size server-side (the browser's
 * reported size is not trustworthy). Returns null when the asset is absent.
 */
export async function getRawResource(
  publicId: string,
): Promise<{ secureUrl: string; bytes: number } | null> {
  try {
    const r = await cloudinary.api.resource(publicId, { resource_type: 'raw' });
    return { secureUrl: r.secure_url as string, bytes: r.bytes as number };
  } catch (err) {
    // The SDK rejects with a bare object, not an Error, and nests the status
    // one level down: { request_options, query_params, error: { http_code } }.
    const e = err as { http_code?: number; error?: { http_code?: number } };
    if ((e?.error?.http_code ?? e?.http_code) === 404) return null;
    throw err;
  }
}

/** Deletes a `raw` asset — used to clean up an upload we end up rejecting. */
export async function destroyRawResource(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
}

/**
 * Server-side upload of a PRIVATE raw asset (`type: 'authenticated'`).
 *
 * Deliberately separate from `uploadBuffer` rather than an option on it:
 * `uploadBuffer` returns `secure_url`, which is meaningless for an
 * authenticated asset — those are never delivered from a plain URL. Callers
 * here need the `public_id` so they can mint an expiring signed link later, so
 * the return shape differs. Keeping them apart leaves `uploadBuffer`'s nine
 * existing callers untouched.
 *
 * Signed consultant contracts carry phone numbers, bank details and a
 * handwritten signature, so public delivery is not an option for them.
 *
 * NAMING: the public_id is extensionless, exactly like the pitch-deck and
 * consultant-CV raw uploads. This account has Cloudinary's "Allow delivery of
 * PDF and ZIP files" setting OFF, and while it is off any URL ending in `.pdf`
 * returns 401 (verified against the live account — see
 * `src/server/startups/pitch-deck.ts`). `upload_stream` receives no filename,
 * so nothing appends one.
 */
export async function uploadAuthenticatedRaw(
  buffer: Buffer,
  options: { publicId: string; folder?: string },
): Promise<{ publicId: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        public_id: options.publicId,
        resource_type: 'raw',
        type: 'authenticated',
        // A contract is written once. Overwriting one would destroy the very
        // bytes its stored SHA-256 attests to.
        overwrite: false,
      },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error('Authenticated upload failed'));
        resolve({ publicId: result.public_id as string, bytes: result.bytes as number });
      },
    );
    stream.end(buffer);
  });
}

/** How long a minted contract link stays valid. Short — links get forwarded. */
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * Mint an expiring, signed link to an authenticated raw asset.
 *
 * Uses Cloudinary's download API (`api.cloudinary.com/.../raw/download`) rather
 * than a signed delivery URL on `res.cloudinary.com`, for two reasons: it is the
 * form that honours `expires_at` without depending on the paid auth-token
 * feature, and it sidesteps the account's PDF-delivery restriction entirely.
 *
 * `format` is passed empty on purpose — the stored public_id is already the
 * complete identifier, and supplying a format here would make Cloudinary look
 * for `<public_id>.pdf`, which is not what was uploaded.
 */
export function signedRawDownloadUrl(
  publicId: string,
  options: { expiresInSeconds?: number } = {},
): string {
  const ttl = options.expiresInSeconds ?? SIGNED_URL_TTL_SECONDS;
  return cloudinary.utils.private_download_url(publicId, '', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: Math.round(Date.now() / 1000) + ttl,
  });
}

export async function uploadBuffer(
  buffer: Buffer,
  options: { folder?: string; publicId?: string; resourceType?: 'image' | 'raw' } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder ?? 'metwork',
        public_id: options.publicId,
        // 'raw' for non-image documents (PDF CVs); default stays 'image'.
        resource_type: options.resourceType ?? 'image',
        overwrite: true,
      },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error('Upload failed'));
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}
