/**
 * POST   /api/memberships/downgrade — Schedule a downgrade
 * DELETE /api/memberships/downgrade — Cancel a previously scheduled downgrade
 *
 * Downgrades are NOT applied immediately — they take effect at the end of the
 * current billing period (`user.membershipExpiresAt`). Until then the user
 * keeps every benefit of their current paid tier. A daily cron job
 * (`/api/cron/process-downgrades`) flips `membershipCode` once
 * `scheduledChangeDate` passes.
 *
 * Body (POST):
 *   { plan: 'ENTREPRENEUR' | 'FREE' }
 *
 * Response (200):
 *   { scheduledMembershipChange, scheduledChangeDate }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { getEffectiveMembershipCode } from '@/server/memberships/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Target tier — must be strictly lower than the user's current effective tier. */
  plan: z.enum(['ENTREPRENEUR', 'FREE']),
});

// Tier rank — higher number = higher tier.
const TIER_RANK: Record<string, number> = { FREE: 0, ENTREPRENEUR: 1, STARTUP: 2 };

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const userId = guard.user.id;
  const now = new Date();

  const result = await db.update((d) => {
    const user = d.users.find((u) => u.id === userId);
    if (!user) return { ok: false, reason: 'USER_NOT_FOUND' } as const;

    const currentCode = getEffectiveMembershipCode(user);
    const currentRank = TIER_RANK[currentCode] ?? 0;
    const targetRank = TIER_RANK[input.plan] ?? 0;

    if (targetRank >= currentRank) {
      return { ok: false, reason: 'NOT_A_DOWNGRADE' } as const;
    }

    // Schedule the change for the end of the current billing period. If no
    // expiry is set (shouldn't happen for a paid plan but be defensive),
    // schedule it 30 days from now.
    const scheduledChangeDate = user.membershipExpiresAt
      ? user.membershipExpiresAt
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    user.scheduledMembershipChange = input.plan;
    user.scheduledChangeDate = scheduledChangeDate;
    user.updatedAt = now.toISOString();

    return {
      ok: true,
      scheduledMembershipChange: input.plan,
      scheduledChangeDate,
    } as const;
  });

  if (!result.ok) {
    if (result.reason === 'USER_NOT_FOUND') return jsonError(404, 'USER_NOT_FOUND', 'User not found');
    if (result.reason === 'NOT_A_DOWNGRADE') {
      return jsonError(
        422,
        'NOT_A_DOWNGRADE',
        'Target plan must be strictly lower than your current plan',
      );
    }
  }

  return json({
    scheduledMembershipChange: result.scheduledMembershipChange,
    scheduledChangeDate: result.scheduledChangeDate,
  });
}

export async function DELETE() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const userId = guard.user.id;
  const now = new Date();

  await db.update((d) => {
    const user = d.users.find((u) => u.id === userId);
    if (!user) return;
    user.scheduledMembershipChange = null;
    user.scheduledChangeDate = null;
    user.updatedAt = now.toISOString();
  });

  return json({ ok: true });
}
