/**
 * GET /api/admin/analytics/deletions
 *
 * Returns aggregated metrics for self-service account deletions:
 *   - totalDeleted: lifetime count
 *   - deletedThisMonth: count for the current calendar month (UTC)
 *   - byRole: counts split by the user's role at the time of deletion
 *   - monthlyTrend: month-by-month counts for the last 6 calendar months
 *
 * ACCOUNT_DELETED audit log entries are written by
 * `src/app/api/auth/account/route.ts` when a user deletes their own account.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json } from '@/server/http/json';
import type { UserRole } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function GET(_req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const deletions = (data.auditLogs ?? []).filter(
    (l) => l.action === 'ACCOUNT_DELETED',
  );

  // ── This month ─────────────────────────────────────────────────────
  const now = new Date();
  const currentKey = monthKey(now);
  const deletedThisMonth = deletions.filter(
    (l) => monthKey(new Date(l.createdAt)) === currentKey,
  ).length;

  // ── By role ────────────────────────────────────────────────────────
  const byRole: Record<UserRole, number> = {
    ENTREPRENEUR: 0,
    INCUBATOR: 0,
    TRAINER: 0,
    ADMIN: 0,
    INVESTOR: 0,
  };
  for (const log of deletions) {
    const role = (log.details as { role?: UserRole } | undefined)?.role;
    if (role && role in byRole) {
      byRole[role] += 1;
    }
  }

  // ── Monthly trend (last 6 months, oldest → newest) ────────────────
  const monthlyTrend: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    const count = deletions.filter(
      (l) => monthKey(new Date(l.createdAt)) === key,
    ).length;
    monthlyTrend.push({ month: key, count });
  }

  return json({
    totalDeleted: deletions.length,
    deletedThisMonth,
    byRole,
    monthlyTrend,
  });
}
