/**
 * GET  /api/admin/copilot-kb — the documents in the live copilot index.
 * POST /api/admin/copilot-kb — add or replace one PDF (multipart `file`),
 *      indexed and published at once, without a deploy.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { indexPdf } from '@/server/copilot/extract';
import { upsertDocument } from '@/server/copilot/kb';
import { currentIndex, KbConflictError, publishIndex } from '@/server/copilot/kb-store';
import { MAX_PRIVATE_DOCUMENT_BYTES, sniffDocumentMime } from '@/server/uploads/sniff';
import { isConfigured as isCloudinaryConfigured } from '@/lib/cloudinary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Text extraction of a whole code + the index upload.
export const maxDuration = 120;

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const pointer = (await db.read()).copilotKb ?? null;
  const index = await currentIndex().catch(() => null);
  return json({ pointer, documents: index?.documents ?? [] });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  if (!isCloudinaryConfigured()) return jsonError(503, 'STORAGE_UNAVAILABLE', 'Document storage is not configured');
  let form: FormData;
  try { form = await req.formData(); } catch {
    return jsonError(400, 'INVALID_FORM', 'Expected multipart form data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(422, 'FILE_REQUIRED', 'Attach a PDF');
  if (file.size > MAX_PRIVATE_DOCUMENT_BYTES) return jsonError(413, 'FILE_TOO_LARGE', 'The file must be 4 MB or smaller');
  const buf = new Uint8Array(await file.arrayBuffer());
  if (sniffDocumentMime(Buffer.from(buf)) !== 'application/pdf') return jsonError(415, 'UNSUPPORTED_FILE', 'Upload a PDF');

  const name = file.name.replace(/[^\p{L}\p{N} ._()'°-]+/gu, '_').slice(0, 160) || 'document.pdf';
  const basedOn = (await db.read()).copilotKb?.publicId ?? null;
  const index = await currentIndex();
  let result;
  try {
    result = await indexPdf(`admin/${name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`}`, buf, 'ADMIN');
  } catch {
    return jsonError(422, 'UNREADABLE_PDF', 'This PDF could not be read');
  }
  if (!result.ok) return jsonError(422, 'NO_TEXT', 'This PDF is a scan with no text layer — it cannot be indexed without OCR');
  try {
    const pointer = await publishIndex(upsertDocument(index, result.doc, result.chunks), basedOn);
    return json({ document: result.doc, pointer }, { status: 201 });
  } catch (err) {
    if (err instanceof KbConflictError) return jsonError(409, 'CONFLICT', 'The knowledge base changed meanwhile — reload and retry');
    throw err;
  }
}
