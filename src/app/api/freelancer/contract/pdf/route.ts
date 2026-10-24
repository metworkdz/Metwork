/** GET /api/freelancer/contract/pdf?id= — the caller's signed contract. */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { jsonError } from '@/server/http/json';
import { signedContractPdf } from '@/server/freelancer-contracts/service';
import { pdfResponse } from '@/server/consultant-contracts/pdf-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const bytes = /^[0-9a-f-]{36}$/i.test(id) ? await signedContractPdf(guard.user.id, id) : null;
  return bytes ? pdfResponse(bytes, `Contrat-freelancer-Metwork-${id.slice(0, 8)}.pdf`) : jsonError(404, 'NOT_FOUND', 'Signed contract not found');
}
