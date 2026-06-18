/**
 * GET /api/admin/mentor-withdrawals — list consultant (mentor) withdrawal
 * requests for the admin, newest first. Mirrors /api/admin/withdrawals (user
 * wallet) but reads the parallel mentor ledger. Admin only.
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
  const mentorsById = new Map((data.mentors ?? []).map((m) => [m.id, m]));

  const items = (data.mentorWithdrawals ?? [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((w) => {
      const mentor = mentorsById.get(w.mentorId);
      const wallet = (data.mentorWallets ?? []).find((x) => x.mentorId === w.mentorId);
      return {
        ...w,
        mentorName: mentor?.fullName ?? 'Unknown',
        mentorEmail: mentor?.email ?? '',
        availableBalance: wallet?.availableBalance ?? 0,
      };
    });

  return json({ items, total: items.length });
}
