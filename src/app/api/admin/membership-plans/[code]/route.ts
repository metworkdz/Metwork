/**
 * PATCH /api/admin/membership-plans/[code]
 *
 * Update one entrepreneur membership plan's pricing and benefits. Admin only.
 * Mirrors the commission-rules editor: partial body, seeds defaults on first
 * write, returns the updated record.
 *
 * FROZEN-SNAPSHOT CONTRACT: everything written here affects only FUTURE
 * purchases. Active memberships carry their own snapshot and are never
 * repriced by this endpoint — see `resolveMemberBenefits`.
 *
 * `monthlyPassCount` is NOT stored on the plan record. It lives in
 * `meta.platformConfig` and is written exclusively through
 * `setAdminCreditConfig`, which also audit-logs and busts the credit cache.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { DEFAULT_MEMBERSHIP_PLAN_CONFIGS } from '@/server/admin/settings-defaults';
import { normalizePlanCode, passCountFrom } from '@/server/memberships/plan-config';
import { getAdminCreditConfig, setAdminCreditConfig } from '@/server/network/credit-service';
import { computeCyclePrices } from '@/lib/billing-cycles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    monthlyPrice:             z.number().int().min(0).max(10_000_000).optional(),
    annualDiscountPercent:    z.number().min(0).max(100).optional(),
    consultationDiscountRate: z.number().min(0).max(1).optional(),
    spaceDiscountRate:        z.number().min(0).max(1).optional(),
    /** Persisted to platformConfig, not to the plan record. */
    monthlyPassCount:         z.number().int().min(0).max(100).optional(),
    recommended:              z.boolean().optional(),
    isActive:                 z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });

interface RouteParams { params: Promise<{ code: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { code } = await params;
  const planCode = normalizePlanCode(code);
  if (!planCode) return jsonError(404, 'NOT_FOUND', 'Unknown membership plan');

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // ── Pass count goes to its canonical home first ─────────────────────────
  // Done before the plan write so a rejected allowance fails the whole request
  // rather than leaving prices updated and passes not.
  if (input.monthlyPassCount !== undefined) {
    const current = await getAdminCreditConfig();
    try {
      await setAdminCreditConfig(
        planCode === 'ENTREPRENEUR' ? input.monthlyPassCount : current.builderCredits,
        planCode === 'STARTUP'      ? input.monthlyPassCount : current.founderCredits,
        guard.user.id,
      );
    } catch (err) {
      return jsonError(422, 'INVALID_PASS_COUNT', err instanceof Error ? err.message : 'Invalid pass count');
    }
  }

  const result = await db.update((store) => {
    if (!Array.isArray(store.membershipPlanConfigs)) store.membershipPlanConfigs = [];
    // Seed defaults if this is the first write (cold start before the admin
    // Commissions page has been visited).
    for (const def of DEFAULT_MEMBERSHIP_PLAN_CONFIGS) {
      if (!store.membershipPlanConfigs.some((c) => c.planCode === def.planCode)) {
        store.membershipPlanConfigs.push({ ...def });
      }
    }

    const plan = store.membershipPlanConfigs.find((c) => c.planCode === planCode);
    if (!plan) return null;

    if (input.monthlyPrice             !== undefined) plan.monthlyPrice             = input.monthlyPrice;
    if (input.annualDiscountPercent    !== undefined) plan.annualDiscountPercent    = input.annualDiscountPercent;
    if (input.consultationDiscountRate !== undefined) plan.consultationDiscountRate = input.consultationDiscountRate;
    if (input.spaceDiscountRate        !== undefined) plan.spaceDiscountRate        = input.spaceDiscountRate;
    if (input.isActive                 !== undefined) plan.isActive                 = input.isActive;
    // "Recommended" is exclusive: promoting one plan demotes the others, so
    // the pricing page can never render two badges.
    if (input.recommended !== undefined) {
      plan.recommended = input.recommended;
      if (input.recommended) {
        for (const other of store.membershipPlanConfigs) {
          if (other.planCode !== planCode) other.recommended = false;
        }
      }
    }
    plan.updatedAt = new Date().toISOString();

    return { plan: { ...plan }, passCount: passCountFrom(store, planCode) };
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Membership plan not found');

  return json({
    plan: result.plan,
    monthlyPassCount: result.passCount,
    // Echo the derived cycle prices so the admin UI never re-implements the math.
    prices: computeCyclePrices({
      monthlyPrice:          result.plan.monthlyPrice,
      semesterlyMonths:      result.plan.semesterlyMonths,
      annualDiscountPercent: result.plan.annualDiscountPercent,
    }),
  });
}
