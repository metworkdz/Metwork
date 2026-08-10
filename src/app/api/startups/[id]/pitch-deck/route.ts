/**
 * POST /api/startups/:id/pitch-deck — founder self-service pitch deck upload.
 *
 * multipart/form-data:
 *   file — the PDF binary
 *
 * Mirrors /api/consultant/upload: Cloudinary when configured, public/uploads
 * disk fallback in dev. Guarded by session + listing ownership (same
 * founder-only check as PATCH /api/startups/:id).
 *
 * Non-blocking rule: a failed upload returns an error and touches nothing —
 * the rest of the startup profile is saved independently via PATCH.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { findStartupById } from '@/server/startups/service';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import {
  isConfigured,
  isSupportedDocumentMime,
  uploadBuffer,
  MAX_UPLOAD_BYTES,
} from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const listing = await findStartupById(id);
  if (!listing) return jsonError(404, 'NOT_FOUND', 'Startup not found');
  if (listing.founderId !== guard.user.id) return jsonError(403, 'FORBIDDEN', 'Not your startup');

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart/form-data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'FILE_REQUIRED', 'No file uploaded under field "file"');
  if (file.size === 0) return jsonError(400, 'EMPTY_FILE', 'File is empty');
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'Max 5 MB');
  if (!isSupportedDocumentMime(file.type)) {
    return jsonError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Pitch deck must be a PDF');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let url: string;

  if (isConfigured()) {
    try {
      url = await uploadBuffer(buffer, {
        folder: 'metwork/pitch-decks',
        resourceType: 'raw',
      });
    } catch (err) {
      console.error('[startups/pitch-deck] Cloudinary error:', err);
      const msg = err instanceof Error ? err.message : 'Cloudinary upload failed';
      return jsonError(500, 'UPLOAD_FAILED', msg);
    }
  } else {
    // Local filesystem fallback (dev only — filesystem is read-only on Vercel)
    const filename = `${randomUUID()}.pdf`;
    const dir = path.join(process.cwd(), 'public', 'uploads', 'pitch-decks');
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buffer);
    } catch (err) {
      console.error('[startups/pitch-deck] Filesystem fallback error:', err);
      return jsonError(500, 'UPLOAD_FAILED', 'File write failed. Configure CLOUDINARY_* env vars for production.');
    }
    url = `/uploads/pitch-decks/${filename}`;
  }

  // Persist onto the listing only after a successful upload.
  await db.update((d) => {
    const record = d.startupListings.find((l) => l.id === id);
    if (!record) return;
    record.pitchDeckUrl = url;
    record.updatedAt = new Date().toISOString();
  });

  return json({ url }, { status: 201 });
}
