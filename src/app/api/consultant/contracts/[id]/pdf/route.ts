/**
 * GET /api/consultant/contracts/:id/pdf
 *
 * A freshly-minted, short-lived link to the consultant's own signed contract.
 *
 * Returns the URL rather than proxying the bytes: the asset is private on
 * Cloudinary and the signed link is what grants access, so handing it back
 * keeps this function out of the download path entirely. The link is minted per
 * request because the stored one will usually have expired.
 */
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { json, jsonError } from '@/server/http/json';
import { findContractById, getContractPdfUrl } from '@/server/consultant-contracts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  const contract = await findContractById(id);
  if (!contract || contract.consultantId !== guard.mentorId) {
    return jsonError(404, 'NOT_FOUND', 'Contract not found');
  }

  const url = await getContractPdfUrl(id);
  if (!url) return jsonError(404, 'NO_PDF', 'This contract has no signed document yet.');

  return json({ url });
}
