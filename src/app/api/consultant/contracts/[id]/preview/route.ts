/**
 * GET /api/consultant/contracts/:id/preview
 *
 * The readable DRAFT of a contract, served inline as a PDF.
 *
 * Exists because the consultant previously had only the plain-text body on
 * screen before signing — they were asked to sign a document they had never
 * seen rendered. This returns the same frozen `contentSnapshot`, laid out
 * exactly as the final document, watermarked "PROJET — NON SIGNÉ" and with
 * empty signature lines.
 *
 * Generated per request and never stored: a preview cannot drift from what the
 * signature will be applied to, and no unsigned copy is left lying in storage.
 */
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { jsonError } from '@/server/http/json';
import {
  findContractById,
  generateContractPreviewPdf,
  markContractViewed,
} from '@/server/consultant-contracts/service';
import { contractPreviewFilename, pdfResponse } from '@/server/consultant-contracts/pdf-response';
import { findMentorById } from '@/server/mentors/service';

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

  const bytes = await generateContractPreviewPdf(id);
  if (!bytes) return jsonError(404, 'NOT_FOUND', 'Contract not found');

  // Reading the draft is the act the audit trail cares about — it is the
  // evidence the consultant saw the document before signing it.
  void markContractViewed(id, guard.mentorId);

  const mentor = await findMentorById(guard.mentorId);
  return pdfResponse(bytes, contractPreviewFilename(mentor?.fullName ?? ''));
}
