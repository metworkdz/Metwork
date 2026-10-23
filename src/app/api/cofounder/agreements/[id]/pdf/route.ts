/** GET /api/cofounder/agreements/[id]/pdf — the signed agreement, for either founder. */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { jsonError } from '@/server/http/json';
import { signedPdf } from '@/server/cofounder/agreement';
import { pdfResponse } from '@/server/consultant-contracts/pdf-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const bytes = await signedPdf(guard.user.id, id);
  return bytes ? pdfResponse(bytes, `Accord-cofondateurs-${id.slice(0, 8)}.pdf`) : jsonError(404, 'NOT_FOUND', 'Signed agreement not found');
}
