/**
 * POST /api/incubator/upload
 *
 * Accepts a multipart form with a `file` field (image, max 5 MB).
 * Uploads to Cloudinary when configured; falls back to public/uploads on disk.
 * Returns { url }.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import {
  isConfigured,
  isSupportedMime,
  uploadBuffer,
  MAX_UPLOAD_BYTES,
} from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN', 'TRAINER']);
  if (!guard.ok) return guard.response;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart/form-data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'No file under field "file"');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'File is empty');
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'Max 5 MB');
  if (!isSupportedMime(file.type)) return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'jpg, png, webp, gif or avif only');

  const buffer = Buffer.from(await file.arrayBuffer());

  if (isConfigured()) {
    try {
      const url = await uploadBuffer(buffer, { folder: 'metwork/spaces' });
      return json({ url, size: file.size }, { status: 201 });
    } catch (err) {
      console.error('[incubator/upload] Cloudinary error:', err);
      const msg = err instanceof Error ? err.message : 'Cloudinary upload failed';
      return jsonError(500, 'UPLOAD_FAILED', msg);
    }
  }

  // Local filesystem fallback (dev only — filesystem is read-only on Vercel)
  const ext = MIME_TO_EXT[file.type];
  const filename = `${randomUUID()}.${ext}`;
  const dir = path.join(process.cwd(), 'public', 'uploads', 'incubators');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
  } catch (err) {
    console.error('[incubator/upload] Filesystem fallback error:', err);
    return jsonError(500, 'UPLOAD_FAILED', 'File write failed. Configure CLOUDINARY_* env vars for production.');
  }
  return json({ url: `/uploads/incubators/${filename}`, size: file.size }, { status: 201 });
}
