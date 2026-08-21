/**
 * GET /api/consultant/contracts
 *
 * The signing consultant's own contracts, newest first. Drives both the portal
 * banner and the contract tab from one request.
 *
 * Scoped to `guard.mentorId` — a consultant can only ever see contracts issued
 * to them, and no id from the client participates in the lookup.
 *
 * Opening a contract that is awaiting signature records a VIEWED audit event,
 * but only the FIRST time: the trail should answer "when did they first see
 * this", not accumulate an entry per page refresh.
 */
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { json, jsonError } from '@/server/http/json';
import {
  findContractsByConsultant,
  markContractViewedOnce,
} from '@/server/consultant-contracts/service';
import { mintContractPdfUrl } from '@/server/consultant-contracts/storage';
import { toConsultantContractDto } from '@/server/consultant-contracts/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const contracts = await findContractsByConsultant(guard.mentorId);

  for (const contract of contracts) {
    if (contract.status !== 'PENDING_SIGNATURE') continue;
    // The already-viewed test happens inside the write lock (see
    // markContractViewedOnce) — checking it out here against this snapshot
    // would let two concurrent loads both append.
    await markContractViewedOnce(contract.id, guard.mentorId);
  }

  return json({
    contracts: contracts.map((c) =>
      toConsultantContractDto(c, {
        // Links expire, so they are minted per response rather than served
        // from the stored value.
        pdfUrl: c.finalPdfPublicId ? mintContractPdfUrl(c.finalPdfPublicId) : null,
      }),
    ),
  });
}
