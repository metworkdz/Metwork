/**
 * POST /api/admin/memberships
 * Assign or update a membership plan for a user. Admin only.
 * If the user already has an ACTIVE membership, the old one is cancelled.
 */
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db, type UserMembershipRecord } from '@/server/db/store';
import { planConfigsFrom, passCountFrom, normalizePlanCode } from '@/server/memberships/plan-config';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  userId:    z.string().uuid(),
  plan:      z.enum(['FREE', 'ENTREPRENEUR', 'STARTUP']),
  expiresAt: z.string().datetime().nullable().default(null),
});

/**
 * Returns midnight UTC on the 1st of the month following `from`. Mirrors
 * the helper inside `credit-service.ts` — kept inline here so the admin
 * route does not pull in the whole credit-service module just for one line.
 */
function nextFirstOfMonthIso(from: Date = new Date()): string {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)).toISOString();
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const now = new Date().toISOString();

  const result = await db.update((store) => {
    const user = store.users.find((u) => u.id === input.userId);
    if (!user) return null;

    // Cancel any existing active membership for this user
    store.userMemberships
      .filter((m) => m.userId === input.userId && m.status === 'ACTIVE')
      .forEach((m) => { m.status = 'CANCELLED'; m.updatedAt = now; });

    const record: UserMembershipRecord = {
      id:        crypto.randomUUID(),
      userId:    input.userId,
      plan:      input.plan,
      startsAt:  now,
      expiresAt: input.expiresAt,
      status:    'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    };
    store.userMemberships.push(record);

    // Keep user.membershipCode in sync
    user.membershipCode = input.plan === 'FREE' ? null : input.plan;

    // ── Seed Network Pass credits to match the new tier ────────────────
    // Without this, the admin-granted membership has 0 credits until the
    // monthly cron fires — meaning the partner-incubator owner can't
    // actually use their pass for weeks. Mirrors the logic in
    // `partner-promo-service.applyPromoCode` (~lines 480-505).
    // Allowance comes from the canonical platform config, never from literals.
    const allowance = passCountFrom(store, input.plan);
    const planCode = normalizePlanCode(input.plan);
    const planConfig = planCode
      ? planConfigsFrom(store).find((c) => c.planCode === planCode) ?? null
      : null;

    const tier: 'EXPLORER' | 'BUILDER' | 'FOUNDER' =
      input.plan === 'STARTUP' ? 'FOUNDER' : input.plan === 'ENTREPRENEUR' ? 'BUILDER' : 'EXPLORER';

    // Freeze the granted terms onto the record + user mirror, exactly like a
    // paid purchase, so the grant is not silently repriced by a later edit.
    if (planConfig) {
      record.spaceDiscountRate        = planConfig.spaceDiscountRate;
      record.consultationDiscountRate = planConfig.consultationDiscountRate;
      record.monthlyPassCount         = allowance;
      record.snapshotAt               = now;
      user.membershipSpaceDiscountRate        = planConfig.spaceDiscountRate;
      user.membershipConsultationDiscountRate = planConfig.consultationDiscountRate;
    } else {
      delete user.membershipSpaceDiscountRate;
      delete user.membershipConsultationDiscountRate;
    }

    user.membershipTier = tier;
    user.networkCreditsMax = allowance;
    user.networkCredits = allowance;
    user.networkCreditsResetDate = nextFirstOfMonthIso();
    // Fresh allowance period — wipe the per-month usage counter so the
    // user starts at 0/MAX visits.
    user.networkPassesUsedThisMonth = 0;
    user.membershipStartDate = now;
    user.membershipExpiresAt = input.expiresAt;
    user.membershipRenewalDate = input.expiresAt;
    user.updatedAt = now;

    return record;
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'User not found');
  return json({ membership: result }, { status: 201 });
}
