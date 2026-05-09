/**
 * GET  /api/incubator/subscription  — current subscription info
 * POST /api/incubator/subscription  — switch plan or activate/renew
 *
 * Body for POST:
 *   { action: 'SWITCH_TO_COMMISSION' }
 *   { action: 'ACTIVATE_FLAT'; billingCycle: 'SEMESTERLY' | 'YEARLY' }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import {
  findIncubatorByUserEmail,
  getPlatformConfig,
  computeSubscriptionPricing,
  computePeriodEnd,
  isSubscriptionActive,
} from '@/server/incubator/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const switchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SWITCH_TO_COMMISSION') }),
  z.object({
    action: z.literal('ACTIVATE_FLAT'),
    billingCycle: z.enum(['SEMESTERLY', 'YEARLY']),
  }),
]);

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const cfg = await getPlatformConfig();
  const pricing = computeSubscriptionPricing(cfg);

  return json({
    subscriptionCode:         inc.subscriptionCode,
    billingCycle:             inc.billingCycle,
    subscriptionStatus:       inc.subscriptionStatus ?? 'NONE',
    subscriptionPeriodStart:  inc.subscriptionPeriodStart,
    subscriptionPeriodEnd:    inc.subscriptionPeriodEnd,
    subscriptionLastPaidAmount: inc.subscriptionLastPaidAmount,
    isActive:                 isSubscriptionActive(inc),
    pricing,
    commissionRate:           cfg.commissionRate,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = switchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const cfg = await getPlatformConfig();
  const now = new Date().toISOString();

  const updated = await db.update((d) => {
    const record = (d.incubators ?? []).find((x) => x.id === inc.id);
    if (!record) return null;

    if (input.action === 'SWITCH_TO_COMMISSION') {
      record.subscriptionCode         = 'COMMISSION';
      record.billingCycle             = null;
      record.subscriptionStatus       = 'NONE';
      record.subscriptionPeriodStart  = null;
      record.subscriptionPeriodEnd    = null;
      record.subscriptionLastPaidAmount = null;
    } else {
      // ACTIVATE_FLAT
      const pricing     = computeSubscriptionPricing(cfg);
      const paidAmount  = input.billingCycle === 'YEARLY'
        ? pricing.yearlyAmount
        : pricing.semesterlyAmount;
      const periodEnd   = computePeriodEnd(now, input.billingCycle, cfg.semesterlyMonths);

      record.subscriptionCode           = 'FLAT';
      record.billingCycle               = input.billingCycle;
      record.subscriptionStatus         = 'ACTIVE';
      record.subscriptionPeriodStart    = now;
      record.subscriptionPeriodEnd      = periodEnd;
      record.subscriptionLastPaidAmount = paidAmount;
    }

    record.updatedAt = now;
    return record;
  });

  if (!updated) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'Incubator not found');

  const pricing = computeSubscriptionPricing(cfg);
  return json({
    subscriptionCode:           updated.subscriptionCode,
    billingCycle:               updated.billingCycle,
    subscriptionStatus:         updated.subscriptionStatus,
    subscriptionPeriodStart:    updated.subscriptionPeriodStart,
    subscriptionPeriodEnd:      updated.subscriptionPeriodEnd,
    subscriptionLastPaidAmount: updated.subscriptionLastPaidAmount,
    isActive:                   isSubscriptionActive(updated),
    pricing,
  });
}
