/** DELETE /api/admin/copilot-kb/[id] — remove one document from the live copilot index. */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { removeDocument } from '@/server/copilot/kb';
import { currentIndex, KbConflictError, publishIndex } from '@/server/copilot/kb-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Ctx { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const id = decodeURIComponent((await params).id);
  const basedOn = (await db.read()).copilotKb?.publicId ?? null;
  const index = await currentIndex();
  if (!index.documents.some((d) => d.id === id)) return jsonError(404, 'NOT_FOUND', 'Document not found');
  try {
    const pointer = await publishIndex(removeDocument(index, id), basedOn);
    return json({ ok: true, pointer });
  } catch (err) {
    if (err instanceof KbConflictError) return jsonError(409, 'CONFLICT', 'The knowledge base changed meanwhile — reload and retry');
    throw err;
  }
}
