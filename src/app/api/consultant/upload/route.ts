/**
 * POST /api/consultant/upload — consultant self-service avatar / CV / program
 * image upload.
 *
 * multipart/form-data:
 *   file — the binary (image for avatar/program, PDF for cv)
 *   kind — 'avatar' (default) | 'cv' | 'program' | 'invoice-logo' | 'invoice-stamp'
 *
 * Mirrors the admin upload route (/api/mentors/upload): Cloudinary when
 * configured, public/uploads disk fallback in dev. Guarded by the consultant
 * session (requireConsultant) — the admin route stays admin-only.
 *
 * On success the URL is saved onto the consultant's own MentorRecord
 * (imageUrl / cvUrl) for 'avatar'/'cv'. 'program' returns just `{ url }` and
 * writes nothing — the caller (the program create/edit form) attaches it to
 * whichever ProgramRecord it's building, the same way GalleryUploadField's
 * default endpoint (/api/incubator/upload) already behaves for incubators.
 * Non-blocking rule: a failed upload returns an error and touches nothing —
 * the account/profile state can never be corrupted.
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

/** Where each kind is stored. One map, so a new kind cannot be half-wired. */
const UPLOAD_FOLDER = {
  avatar: 'metwork/mentors',
  cv: 'metwork/consultant-cvs',
  program: 'metwork/consultant-programs',
  'invoice-logo': 'metwork/consultant-invoices',
  'invoice-stamp': 'metwork/consultant-invoices',
} as const;

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

  // An unknown kind falls back to 'avatar', which is what every caller that
  // omits it means — but each kind is listed, so adding one is deliberate.
  const KINDS = ['avatar', 'cv', 'program', 'invoice-logo', 'invoice-stamp'] as const;
  type UploadKind = (typeof KINDS)[number];
  const kindRaw = String(form.get('kind') ?? '');
  const kind: UploadKind = (KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as UploadKind)
    : 'avatar';
  /** Everything except the CV is an image. */
  const isImage = kind !== 'cv';
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'File is empty');
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'Max 5 MB');
  if (isImage && !isSupportedMime(file.type)) {
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
        folder: UPLOAD_FOLDER[kind],
        resourceType: isImage ? 'image' : 'raw',
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
    const sub = UPLOAD_FOLDER[kind].replace(/^metwork\//, '');
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

  // 'program' images belong to whichever ProgramRecord the caller is
  // building, not to this consultant's own profile — write nothing.
  if (kind !== 'program') {
    await db.update((d) => {
      const mentor = (d.mentors ?? []).find((m) => m.id === guard.mentorId);
      if (!mentor) return;
      if (kind === 'cv') mentor.cvUrl = url;
      // The invoice letterhead and stamp are their OWN fields: a headshot is
      // not a letterhead, and overwriting imageUrl with a logo would change
      // the consultant's public photo.
      else if (kind === 'invoice-logo') mentor.invoiceLogoUrl = url;
      else if (kind === 'invoice-stamp') mentor.invoiceStampUrl = url;
      else mentor.imageUrl = url;
    });
  }

  return json({ url, kind, size: file.size }, { status: 201 });
}
