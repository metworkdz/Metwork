/** PATCH /api/admin/message-reports/[id] — mark a report resolved. */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const now = new Date().toISOString();
  const ok = await db.update((d) => {
    const r = (d.messageReports ?? []).find((x) => x.id === id);
    if (!r) return false;
    r.status = 'RESOLVED';
    r.resolvedBy = guard.user.id;
    r.resolvedAt = now;
    return true;
  });
  return ok ? json({ ok: true }) : jsonError(404, 'NOT_FOUND', 'Report not found');
}
