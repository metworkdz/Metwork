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
  const items = data.withdrawalRequests
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => {
      const user = data.users.find((u) => u.id === r.userId);
      return {
        ...r,
        userName: user?.fullName ?? 'Unknown',
        userEmail: user?.email ?? '',
        userRole: user?.role ?? '',
      };
    });

  return json({ items, total: items.length });
}
