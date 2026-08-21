/** DELETE /api/metworkcrm/documents/:id — removes the DB row and its links (not the Cloudinary asset — see SESSION_LOG) */
import type { NextRequest } from 'next/server';
import { noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse } from '@/server/metworkcrm/http';
import { deleteDocument } from '@/server/metworkcrm/services/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteDocument(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
