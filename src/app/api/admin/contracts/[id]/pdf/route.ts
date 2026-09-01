/**
 * GET /api/admin/contracts/:id/pdf
 *
 * Streams a signed contract as a real PDF for the admin queue. Mirrors the
 * consultant route — see `pdf-response.ts` for why the bytes are served here
 * instead of handing out the Cloudinary link (that link renders as a blank tab).
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { findContractById, getContractPdfBytes } from '@/server/consultant-contracts/service';
import { contractPdfFilename, pdfResponse } from '@/server/consultant-contracts/pdf-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const contract = await findContractById(id);
  if (!contract) return jsonError(404, 'NOT_FOUND', 'Contract not found');

  const bytes = await getContractPdfBytes(id);
  if (!bytes) return jsonError(404, 'NO_PDF', 'This contract has no signed document yet.');

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === contract.consultantId);
  return pdfResponse(bytes, contractPdfFilename(mentor?.fullName ?? '', contract.signedAt));
}
