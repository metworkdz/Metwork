/**
 * GET /api/consultant/earnings — the consultant's wallet + ledger history.
 */
import { json, jsonError } from '@/server/http/json';
import { requireConsultant } from '@/server/mentors/access';
import { getMentorLedgerView } from '@/server/mentors/ledger';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const view = await getMentorLedgerView(guard.mentorId);
  return json({
    wallet: {
      pendingBalance: view.wallet.pendingBalance,
      availableBalance: view.wallet.availableBalance,
      currency: view.wallet.currency,
      status: view.wallet.status,
    },
    transactions: view.txns.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      bucket: t.bucket,
      status: t.status,
      description: t.description,
      bookingId: t.bookingId,
      createdAt: t.createdAt,
    })),
  });
}
