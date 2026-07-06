/**
 * GET /api/consultations
 * List the current user's mentor consultations, newest first.
 * Also returns free-quota summary for the current month.
 */
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';
import { getUserConsultationQuota } from '@/server/memberships/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const userId = guard.user.id;

  // Single source of truth for the monthly free-session quota — the same
  // resolver the instant-book write path and the dashboard page use.
  const [data, quota] = await Promise.all([
    db.read(),
    getUserConsultationQuota(userId),
  ]);

  const all = (data.mentorConsultations ?? [])
    .filter((c) => c.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({
    items: all,
    total: all.length,
    freeQuota: quota.quota,
    freeSessionsUsed: quota.used,
    freeSessionsRemaining: quota.remaining,
  });
}
