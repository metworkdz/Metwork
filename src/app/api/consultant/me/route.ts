/**
 * GET /api/consultant/me — the signed-in consultant's profile + wallet summary.
 */
import { json, jsonError } from '@/server/http/json';
import { requireConsultant } from '@/server/mentors/access';
import { findMentorById } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { getOrCreateMentorWallet } from '@/server/mentors/ledger';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Consultant not found');

  const wallet = await getOrCreateMentorWallet(guard.mentorId);
  return json({
    mentor: toMentorDto(mentor),
    wallet: {
      pendingBalance: wallet.pendingBalance,
      availableBalance: wallet.availableBalance,
      currency: wallet.currency,
      status: wallet.status,
    },
  });
}
