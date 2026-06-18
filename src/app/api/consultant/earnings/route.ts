/**
 * GET /api/consultant/earnings — the consultant's wallet + ledger history,
 * plus a read-only summary (consultations / gross / commission / net) that
 * mirrors the admin mentor-revenue page, scoped to this consultant.
 *
 * The summary is pure display aggregation over already-authoritative data — no
 * new split math:
 *   consultations = the consultant's settled (earned) bookings
 *   gross         = Σ frozen `amountCharged` over those bookings
 *   net           = Σ ledger consultant credits (EARNING + REVERSAL)
 *   commission    = gross − net (the platform's share)
 */
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { getMentorLedgerView } from '@/server/mentors/ledger';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Booking statuses that represent a real, earning consultation (mirrors admin). */
const EARNED_STATUSES = new Set(['APPROVED', 'CONFIRMED', 'READY', 'COMPLETED']);

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const view = await getMentorLedgerView(guard.mentorId);

  // ── Summary (display only) ────────────────────────────────────────────────
  const data = await db.read();
  let consultations = 0;
  let gross = 0;
  for (const b of data.mentorBookings ?? []) {
    if (b.mentorId !== guard.mentorId) continue;
    if (!EARNED_STATUSES.has(b.status)) continue;
    consultations += 1;
    gross += b.amountCharged ?? 0;
  }
  // Net = lifetime consultant credits from the ledger (EARNING credits less any
  // REVERSAL on cancellation). RELEASE/PAYOUT/COMMISSION are excluded (bucket
  // transfers / withdrawals / the platform's own audit row).
  const net = view.txns.reduce(
    (sum, t) => (t.type === 'EARNING' || t.type === 'REVERSAL' ? sum + t.amount : sum),
    0,
  );
  const commission = gross - net;

  return json({
    wallet: {
      pendingBalance: view.wallet.pendingBalance,
      availableBalance: view.wallet.availableBalance,
      currency: view.wallet.currency,
      status: view.wallet.status,
    },
    summary: { consultations, gross, commission, net },
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
