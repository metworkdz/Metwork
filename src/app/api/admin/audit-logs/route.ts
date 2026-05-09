/**
 * GET /api/admin/audit-logs
 *
 * Returns the most recent admin audit log entries (newest first).
 * Restricted to ADMIN role.
 *
 * Query params:
 *   limit  — max entries to return (default 100, max 500)
 */
import type { NextRequest } from 'next/server';
import { requireApiSession } from '@/server/auth/api-guards';
import { listAuditLogs } from '@/server/audit/service';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;
  if (guard.user.role !== 'ADMIN') return jsonError(403, 'FORBIDDEN', 'Admin only');

  const raw = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(500, Math.max(1, parseInt(raw ?? '100', 10) || 100));

  const logs = await listAuditLogs(limit);
  return json({ items: logs, total: logs.length });
}
