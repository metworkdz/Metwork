/**
 * GET /api/consultant/contracts/:id/pdf
 *
 * Streams the consultant's own signed contract as a real PDF.
 *
 * It used to return the Cloudinary signed URL for the client to open. That is
 * why the signed contract appeared as a blank page: Cloudinary's download
 * endpoint answers `Content-Type: application/octet-stream` with
 * `Content-Disposition: attachment` and a filename derived from our
 * extensionless public_id — so `window.open()` produced an empty tab plus an
 * unopenable file. Serving the bytes here lets us set the content type and an
 * INLINE disposition, which is what a browser actually renders.
 *
 * The asset stays private on Cloudinary; only this server can mint a link to it.
 */
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { jsonError } from '@/server/http/json';
import { findContractById, getContractPdfBytes } from '@/server/consultant-contracts/service';
import { findMentorById } from '@/server/mentors/service';
import { contractPdfFilename, pdfResponse } from '@/server/consultant-contracts/pdf-response';

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

  const bytes = await getContractPdfBytes(id);
  if (!bytes) return jsonError(404, 'NO_PDF', 'This contract has no signed document yet.');

  // Name the file after the consultant, not their id — this lands in their
  // Downloads folder and needs to be recognisable a year from now.
  const mentor = await findMentorById(guard.mentorId);
  return pdfResponse(bytes, contractPdfFilename(mentor?.fullName ?? '', contract.signedAt));
}
