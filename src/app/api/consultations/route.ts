/**
 * GET /api/consultations
 * List the current user's mentor consultations, newest first.
 * Also returns free-quota summary for the current month.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FREE_QUOTA: Record<string, number> = {
  ENTREPRENEUR: 2,
  STARTUP: 4,
};

function currentQuotaMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const userId = guard.user.id;
  const membershipCode = guard.user.membershipCode ?? '';
  const freeQuota = FREE_QUOTA[membershipCode] ?? 0;
  const quotaMonth = currentQuotaMonth();

  const data = await db.read();
  const all = (data.mentorConsultations ?? [])
    .filter((c) => c.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const usedThisMonth = all.filter(
    (c) =>
      c.quotaMonth === quotaMonth &&
      c.chargeType === 'FREE_QUOTA' &&
      c.status !== 'CANCELLED',
  ).length;

  return json({
    items: all,
    total: all.length,
    freeQuota,
    freeSessionsUsed: usedThisMonth,
    freeSessionsRemaining: Math.max(0, freeQuota - usedThisMonth),
  });
}
