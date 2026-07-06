/**
 * POST /api/consultant/upload — consultant self-service avatar / CV upload.
 *
 * multipart/form-data:
 *   file — the binary (image for avatar, PDF for cv)
 *   kind — 'avatar' (default) | 'cv'
 *
 * Mirrors the admin upload route (/api/mentors/upload): Cloudinary when
 * configured, public/uploads disk fallback in dev. Guarded by the consultant
 * session (requireConsultant) — the admin route stays admin-only.
 *
 * On success the URL is saved onto the consultant's own MentorRecord
 * (imageUrl / cvUrl). Non-blocking rule: a failed upload returns an error and
 * touches nothing — the account/profile state can never be corrupted.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { json, jsonError } from '@/server/http/json';
import {
  isConfigured,
  isSupportedMime,
  isSupportedDocumentMime,
  uploadBuffer,
  MAX_UPLOAD_BYTES,
} from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart/form-data');
  }

  const kind = form.get('kind') === 'cv' ? 'cv' : 'avatar';
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'File is empty');
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'Max 5 MB');
  if (kind === 'avatar' && !isSupportedMime(file.type)) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Image must be jpg, png, webp, gif, or avif');
  }
  if (kind === 'cv' && !isSupportedDocumentMime(file.type)) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'CV must be a PDF');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let url: string;

  if (isConfigured()) {
    try {
      url = await uploadBuffer(buffer, {
        folder: kind === 'cv' ? 'metwork/consultant-cvs' : 'metwork/mentors',
        resourceType: kind === 'cv' ? 'raw' : 'image',
      });
    } catch (err) {
      console.error('[consultant/upload] Cloudinary error:', err);
      const msg = err instanceof Error ? err.message : 'Cloudinary upload failed';
      return jsonError(500, 'UPLOAD_FAILED', msg);
    }
  } else {
    // Local filesystem fallback (dev only — filesystem is read-only on Vercel)
    const ext = MIME_TO_EXT[file.type];
    const filename = `${randomUUID()}.${ext}`;
    const sub = kind === 'cv' ? 'consultant-cvs' : 'mentors';
    const dir = path.join(process.cwd(), 'public', 'uploads', sub);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buffer);
    } catch (err) {
      console.error('[consultant/upload] Filesystem fallback error:', err);
      return jsonError(500, 'UPLOAD_FAILED', 'File write failed. Configure CLOUDINARY_* env vars for production.');
    }
    url = `/uploads/${sub}/${filename}`;
  }

  // Persist onto the consultant's own record — only after a successful upload.
  await db.update((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === guard.mentorId);
    if (!mentor) return;
    if (kind === 'cv') mentor.cvUrl = url;
    else mentor.imageUrl = url;
  });

  return json({ url, kind, size: file.size }, { status: 201 });
}
