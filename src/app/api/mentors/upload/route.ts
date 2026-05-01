/**
 * POST /api/mentors/upload  — admin-only; accepts a multipart form with
 * a `file` field (image), writes it under `public/uploads/mentors/{uuid}.{ext}`,
 * and returns `{ url, filename, size }`.
 *
 * This is the dev-friendly path. In production you'll want to swap to
 * S3/MinIO (env is already wired in `src/lib/env.ts`) — this route is
 * the one place that needs to change.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart/form-data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return jsonError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
  }
  if (file.size === 0) {
    return jsonError(400, 'EMPTY_FILE', 'File is empty');
  }
  if (file.size > MAX_BYTES) {
    return jsonError(413, 'FILE_TOO_LARGE', `Max ${MAX_BYTES / 1024 / 1024}MB`);
  }

  const ext = MIME_TO_EXT[file.type];
  if (!ext) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Image must be jpg, png, webp, gif, or avif');
  }

  const filename = `${randomUUID()}.${ext}`;
  const dir = path.join(process.cwd(), 'public', 'uploads', 'mentors');
  const dest = path.join(dir, filename);

  await fs.mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(dest, bytes);

  return json(
    {
      url: `/uploads/mentors/${filename}`,
      filename,
      size: file.size,
    },
    { status: 201 },
  );
}
