/**
 * Soft-archive / restore an incubator (admin only).
 *
 *   POST   /api/admin/incubators/:id/archive  → set archivedAt (soft delete)
 *   DELETE /api/admin/incubators/:id/archive  → clear archivedAt (restore)
 *
 * Archiving hides the incubator + its listings from every public surface, the
 * network, and admin default lists, and blocks the owner's login — but NEVER
 * touches wallet ledgers, transactions, bookings or invoices (financial history
 * must survive). This is a reversible flag, never a hard delete.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const inc = (d.incubators ?? []).find((x) => x.id === id);
    if (!inc) return null;
    if (!inc.archivedAt) inc.archivedAt = new Date().toISOString();
    inc.updatedAt = new Date().toISOString();
    return inc;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Incubator not found');

  void appendAuditLog({
    adminId: guard.user.id, adminEmail: guard.user.email,
    action: 'INCUBATOR_ARCHIVED', targetType: 'incubator', targetId: id, details: {},
  });

  return json(result);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const result = await db.update((d) => {
    const inc = (d.incubators ?? []).find((x) => x.id === id);
    if (!inc) return null;
    inc.archivedAt = null;
    inc.updatedAt = new Date().toISOString();
    return inc;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Incubator not found');

  void appendAuditLog({
    adminId: guard.user.id, adminEmail: guard.user.email,
    action: 'INCUBATOR_RESTORED', targetType: 'incubator', targetId: id, details: {},
  });

  return json(result);
}
