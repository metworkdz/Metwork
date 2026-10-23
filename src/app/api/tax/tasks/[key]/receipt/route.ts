/**
 * POST /api/tax/tasks/[key]/receipt — attach the filing / payment receipt
 * (multipart `file`). Stored as a private Cloudinary asset; attaching one
 * marks the task done.
 *
 * GET — redirect to a short-lived signed link to the caller's own receipt.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { db } from '@/server/db/store';
import { attachReceipt, checkTask, receiptOf } from '@/server/taxes/service';
import { MAX_PRIVATE_DOCUMENT_BYTES, sniffDocumentMime } from '@/server/uploads/sniff';
import {
  destroyAuthenticatedRaw,
  isConfigured as isCloudinaryConfigured,
  signedRawDownloadUrl,
  uploadAuthenticatedRaw,
} from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECEIPT_FOLDER = 'metwork/tax-receipts';

interface Ctx { params: Promise<{ key: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const key = decodeURIComponent((await params).key);
  if (!(await checkRateLimitDistributed(`tax-receipt:${guard.user.id}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many uploads. Please try again in an hour.');
  }
  if (!isCloudinaryConfigured()) return jsonError(503, 'STORAGE_UNAVAILABLE', 'Document storage is not configured');

  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart form data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(422, 'FILE_REQUIRED', 'Attach the receipt');
  if (file.size > MAX_PRIVATE_DOCUMENT_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'The file must be 4 MB or smaller');
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffDocumentMime(buffer)) return jsonError(415, 'UNSUPPORTED_FILE', 'Upload a JPG, PNG, WebP or PDF');

  // Upload only for a task the caller really has — checked again on attach.
  const check = await checkTask(guard.user.id, key);
  if (!check.ok) {
    return check.reason === 'NO_PROFILE'
      ? jsonError(409, 'NO_TAX_PROFILE', 'Set your legal status first')
      : jsonError(404, 'NOT_FOUND', 'Task not found');
  }
  const { publicId } = await uploadAuthenticatedRaw(buffer, {
    folder: RECEIPT_FOLDER,
    publicId: `${guard.user.id}-${key.replace(/[^A-Z0-9_-]/gi, '_')}-${Date.now()}`,
  });
  const result = await attachReceipt(guard.user.id, key, publicId);
  if (!result.ok) {
    await destroyAuthenticatedRaw(publicId).catch(() => undefined);
    if (result.reason === 'NO_PROFILE') return jsonError(409, 'NO_TAX_PROFILE', 'Set your legal status first');
    return jsonError(404, 'NOT_FOUND', 'Task not found');
  }
  if (result.replaced) await destroyAuthenticatedRaw(result.replaced).catch(() => undefined);
  return json({ key, doneAt: result.state.doneAt, hasReceipt: true }, { status: 201 });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const key = decodeURIComponent((await params).key);
  const publicId = receiptOf(await db.read(), guard.user.id, key);
  if (!publicId) return jsonError(404, 'NOT_FOUND', 'No receipt for this task');
  return NextResponse.redirect(signedRawDownloadUrl(publicId), 302);
}
