/**
 * GET /api/admin/withdrawals — list all withdrawal requests (admin only)
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  // The full destinationAccountSnapshot ships as-is: this is an ADMIN-only
  // endpoint and the admin needs the complete RIB/RIP to wire the money.
  const items = data.withdrawalRequests
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => {
      const user = data.users.find((u) => u.id === r.userId);
      const wallet = data.wallets.find((w) => w.userId === r.userId);
      return {
        ...r,
        userName: user?.fullName ?? 'Unknown',
        userEmail: user?.email ?? '',
        userRole: user?.role ?? '',
        balance: wallet?.balance ?? 0,
      };
    });

  // Accounting total: amount actually sent out (APPROVED = manually settled).
  const totalSent = items
    .filter((r) => r.status === 'APPROVED')
    .reduce((s, r) => s + r.amount, 0);

  return json({ items, total: items.length, totalSent });
}
