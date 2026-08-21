/**
 * DELETE /api/admin/memberships/[id]
 * Cancel a membership. Admin only.
 *
 * Clearing a membership has to undo the SAME set of user fields the grant
 * wrote, or a revoked member keeps their benefits. `getEffectiveMembershipCode`
 * falls back to `membershipTier` when `membershipCode` is null, and
 * `resolveMemberBenefits` falls back to the `membership*DiscountRate` mirror —
 * so clearing only the code left a "revoked" member resolving as BUILDER and
 * still being charged the discounted price. The field list below mirrors the
 * FREE branch of `/api/cron/process-downgrades`, which is the reference
 * implementation for dropping a user to Explorer.
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

    // Supersede every other ACTIVE record for this user too, so no frozen
    // snapshot survives to win in resolveMemberBenefits step 1.
    for (const m of store.userMemberships) {
      if (m.userId !== membership.userId || m.status !== 'ACTIVE') continue;
      m.status = 'CANCELLED';
      m.updatedAt = now;
    }

    const user = store.users.find((u) => u.id === membership.userId);
    if (user) {
      // 1. Code + expiry (expiry is read independently by quota checks).
      user.membershipCode = null;
      user.membershipExpiresAt = null;
      user.membershipStartDate = null;
      user.membershipRenewalDate = null;
      // 2. Tier — the fallback getEffectiveMembershipCode reads when the code
      //    is null. Leaving BUILDER here kept the plan alive after "revoke".
      user.membershipTier = 'EXPLORER';
      // 3. Frozen discount mirror — the fallback resolveMemberBenefits reads.
      delete user.membershipSpaceDiscountRate;
      delete user.membershipConsultationDiscountRate;
      // 4. Network Pass allowance drops to nothing.
      user.networkCredits = 0;
      user.networkCreditsMax = 0;
      user.networkPassesUsedThisMonth = 0;
      // 5. A pending scheduled change is meaningless once the plan is gone.
      user.scheduledMembershipChange = null;
      user.scheduledChangeDate = null;
      user.updatedAt = now;
    }
    return true;
  });

  if (!found) return jsonError(404, 'NOT_FOUND', 'Membership not found');
  return json({ ok: true });
}
