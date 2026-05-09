/**
 * DELETE /api/admin/memberships/[id]
 * Cancel a membership. Admin only.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const now = new Date().toISOString();

  const found = await db.update((store) => {
    const membership = store.userMemberships.find((m) => m.id === id);
    if (!membership) return false;

    membership.status = 'CANCELLED';
    membership.updatedAt = now;

    // Clear both membership fields on the user so no gate still sees them
    // as active (membershipExpiresAt is used by quota checks independently).
    const user = store.users.find((u) => u.id === membership.userId);
    if (user) {
      user.membershipCode = null;
      user.membershipExpiresAt = null;
      user.updatedAt = now;
    }
    return true;
  });

  if (!found) return jsonError(404, 'NOT_FOUND', 'Membership not found');
  return json({ ok: true });
}
