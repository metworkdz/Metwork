/**
 * GET /api/admin/withdrawals — list all withdrawal requests (admin only)
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';
import { maskRib } from '@/server/payouts/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const items = data.withdrawalRequests
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => {
      const user = data.users.find((u) => u.id === r.userId);
      const wallet = data.wallets.find((w) => w.userId === r.userId);
      const ba = user?.payoutBankAccount ?? null;
      return {
        ...r,
        userName: user?.fullName ?? 'Unknown',
        userEmail: user?.email ?? '',
        userRole: user?.role ?? '',
        balance: wallet?.balance ?? 0,
        bankAccount: ba
          ? { title: ba.title, firstname: ba.firstname, lastname: ba.lastname, address: ba.address, ribMasked: maskRib(ba.rib) }
          : null,
      };
    });

  // Accounting totals: amount actually sent out (APPROVED = manual-settled or
  // SlickPay-sent) and the SlickPay fees the platform absorbed on those payouts.
  const totalSent = items
    .filter((r) => r.status === 'APPROVED')
    .reduce((s, r) => s + r.amount, 0);
  const totalSlickpayFees = items.reduce((s, r) => s + (r.payoutFee ?? 0), 0);

  return json({ items, total: items.length, totalSent, totalSlickpayFees });
}
