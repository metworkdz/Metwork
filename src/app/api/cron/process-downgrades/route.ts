/**
 * Vercel Cron — Daily process of scheduled membership downgrades
 *
 * Schedule: `0 1 * * *` (01:00 UTC every day)
 *
 * Iterates users with `scheduledMembershipChange` set and `scheduledChangeDate
 * <= now`, applies the downgrade, resets network credits / consultation
 * quotas to the new tier's values, and clears the scheduled fields.
 *
 * Secured by `CRON_SECRET` env var — same pattern as `/api/cron/reset-credits`.
 */
import { NextResponse } from 'next/server';
import { db, type MembershipTier } from '@/server/db/store';
import { planConfigsFrom, passCountFrom, normalizePlanCode } from '@/server/memberships/plan-config';

export const runtime = 'nodejs';

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  }
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

function missingCronSecret(): Response {
  return NextResponse.json(
    { error: 'CRON_SECRET not configured' },
    { status: 501 },
  );
}

/** Map membershipCode → MembershipTier (network-pass taxonomy). */
function codeToTier(code: string): MembershipTier {
  if (code === 'STARTUP') return 'FOUNDER';
  if (code === 'ENTREPRENEUR') return 'BUILDER';
  return 'EXPLORER';
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return missingCronSecret();
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const now = new Date();
  const errors: string[] = [];
  let processed = 0;

  await db.update((d) => {
    for (const user of d.users) {
      if (!user.scheduledMembershipChange || !user.scheduledChangeDate) continue;
      if (new Date(user.scheduledChangeDate) > now) continue;

      try {
        const target = user.scheduledMembershipChange;
        const targetCode = target === 'FREE' ? null : target;
        const newTier = codeToTier(target);
        // A scheduled change starts a NEW plan period, so the target plan's
        // current terms apply — there is nothing frozen to carry over.
        const targetPlan = normalizePlanCode(target);
        const newMaxCredits = passCountFrom(d, target);
        const targetConfig = targetPlan
          ? planConfigsFrom(d).find((c) => c.planCode === targetPlan) ?? null
          : null;

        user.membershipCode = targetCode;
        user.membershipTier = newTier;
        // Re-point the frozen mirror at the new plan's terms (cleared entirely
        // when dropping to FREE, so no stale discount survives the downgrade).
        if (targetConfig) {
          user.membershipSpaceDiscountRate        = targetConfig.spaceDiscountRate;
          user.membershipConsultationDiscountRate = targetConfig.consultationDiscountRate;
        } else {
          delete user.membershipSpaceDiscountRate;
          delete user.membershipConsultationDiscountRate;
        }
        // Supersede the old membership record so its frozen snapshot stops
        // winning in resolveMemberBenefits.
        for (const m of d.userMemberships ?? []) {
          if (m.userId !== user.id || m.status !== 'ACTIVE') continue;
          if (normalizePlanCode(m.plan) === targetPlan) continue;
          m.status = 'CANCELLED';
          m.updatedAt = now.toISOString();
        }
        // Cap at the new max AND don't grow credits on downgrade — a user with
        // 0 credits remaining shouldn't suddenly gain credits by downgrading.
        user.networkCredits = Math.min(user.networkCredits ?? 0, newMaxCredits);
        user.networkCreditsMax = newMaxCredits;
        user.networkPassesUsedThisMonth = 0;
        // If cancelling, also clear the expiry date.
        if (target === 'FREE') {
          user.membershipExpiresAt = null;
        }
        user.scheduledMembershipChange = null;
        user.scheduledChangeDate = null;
        user.updatedAt = now.toISOString();
        processed++;
      } catch (err) {
        const msg = `Failed to process downgrade for user ${user.id}: ${String(err)}`;
        errors.push(msg);
        console.error('[cron] process-downgrades user error', { userId: user.id, err });
      }
    }
  });

  const durationMs = Date.now() - startedAt;
  console.info('[cron] process-downgrades: finished', {
    processed,
    errorCount: errors.length,
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    processed,
    timestamp: now.toISOString(),
    durationMs,
    errors,
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET && process.env.NODE_ENV !== 'test') {
    return missingCronSecret();
  }
  if (!isCronAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await db.read();
  const pending = data.users.filter((u) => u.scheduledMembershipChange && u.scheduledChangeDate);
  return NextResponse.json({
    ok: true,
    pendingCount: pending.length,
  });
}
