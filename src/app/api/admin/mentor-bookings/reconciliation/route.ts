/**
 * GET /api/admin/mentor-bookings/reconciliation
 *
 * Reconciliation report for the PAID-consultation wallet-debit fix.
 *
 * Before the fix, consultation bookings with chargeType=PAID and amountCharged>0
 * were created without ever debiting the user's wallet — admins approved
 * them and PDF receipts were sent, but no money moved. This endpoint surfaces
 * those legacy rows so the admin can manually reconcile them (either:
 *   1. Issue an invoice off-platform and mark the booking as paid, OR
 *   2. Reverse the booking and ask the client to re-book through the fixed
 *      flow, OR
 *   3. Manually debit via an admin ADJUSTMENT transaction).
 *
 * Returns:
 *   {
 *     items: Array<{
 *       id, mentorName, userName, userEmail, amountCharged, status,
 *       chargeType, createdAt
 *     }>,
 *     totalUnreconciledAmount: integer DZD
 *   }
 *
 * "Unreconciled" = PAID booking with amountCharged > 0 and NO transactionId.
 * Bookings created after the fix will all have transactionId set, so this
 * list naturally drains to zero as legacy rows are resolved.
 *
 * Admin-only.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReconciliationItem {
  id: string;
  mentorId: string;
  mentorName: string | null;
  userId: string | null;
  userName: string;
  userEmail: string;
  amountCharged: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  chargeType: 'PAID';
  createdAt: string;
  /** True when the booking has been APPROVED — i.e. admin sent a receipt without a payment record. Highest-priority items. */
  receiptIssuedWithoutPayment: boolean;
}

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();

  const mentorsById = new Map(
    (data.mentors ?? []).map((m) => [m.id, m.fullName]),
  );

  // Find PAID bookings with no transactionId and a non-zero charge amount.
  // These are the pre-fix legacy rows that need manual reconciliation.
  const unreconciled = (data.mentorBookings ?? [])
    .filter(
      (b) =>
        b.chargeType === 'PAID' &&
        (b.amountCharged ?? 0) > 0 &&
        !b.transactionId,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const items: ReconciliationItem[] = unreconciled.map((b) => ({
    id: b.id,
    mentorId: b.mentorId,
    mentorName: mentorsById.get(b.mentorId) ?? null,
    userId: b.userId,
    userName: b.userName,
    userEmail: b.userEmail,
    amountCharged: b.amountCharged ?? 0,
    status: b.status,
    chargeType: 'PAID',
    createdAt: b.createdAt,
    receiptIssuedWithoutPayment: b.status === 'APPROVED',
  }));

  const totalUnreconciledAmount = items.reduce(
    (sum, it) => sum + it.amountCharged,
    0,
  );

  return json({
    items,
    totalUnreconciledAmount,
    /** Count of bookings where the admin already sent a receipt — these are the
     *  highest-priority items because the platform may owe the mentor a payout
     *  it never collected from the client. */
    receiptIssuedWithoutPaymentCount: items.filter(
      (it) => it.receiptIssuedWithoutPayment,
    ).length,
  });
}
