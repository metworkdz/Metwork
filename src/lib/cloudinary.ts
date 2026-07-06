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
