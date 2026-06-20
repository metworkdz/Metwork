/**
 * GET /api/admin/users/export — download the (filtered) user list (admin only).
 *
 * Query params (all optional):
 *   role, status            — exact match
 *   tier                    — resolved Network Pass tier (EXPLORER|BUILDER|FOUNDER)
 *   from, to                — created-date range (YYYY-MM-DD), inclusive
 *   q                       — name/email search
 *   format=csv|xlsx         — output format (default csv)
 *
 * Server-side generation; never leaks more than the admin Users table shows.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type MembershipTier } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import {
  filterUsersForExport,
  buildUsersCsv,
  buildUsersXlsx,
  type UserExportFilters,
} from '@/server/admin/user-export';
import { USER_ROLES, type UserRole, type UserStatus } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: UserStatus[] = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED'];
const TIERS: MembershipTier[] = ['EXPLORER', 'BUILDER', 'FOUNDER'];

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'xlsx' ? 'xlsx' : 'csv';

  const roleParam = sp.get('role');
  const statusParam = sp.get('status');
  const tierParam = sp.get('tier');

  const filters: UserExportFilters = {
    role: roleParam && USER_ROLES.includes(roleParam as UserRole) ? (roleParam as UserRole) : undefined,
    status: statusParam && STATUSES.includes(statusParam as UserStatus) ? (statusParam as UserStatus) : undefined,
    tier: tierParam && TIERS.includes(tierParam as MembershipTier) ? (tierParam as MembershipTier) : undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    q: sp.get('q') ?? undefined,
  };

  const data = await db.read();
  const filtered = filterUsersForExport(data.users ?? [], filters);

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'xlsx') {
    let buffer: Buffer;
    try {
      buffer = await buildUsersXlsx(filtered);
    } catch (err) {
      console.error('[admin/users/export] xlsx generation failed', err);
      return jsonError(500, 'EXPORT_FAILED', 'Failed to generate spreadsheet');
    }
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="metwork-users-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const csv = buildUsersCsv(filtered);
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="metwork-users-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
