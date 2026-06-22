/**
 * GET  /api/incubator/subscription  — current subscription info
 * POST /api/incubator/subscription  — switch plan or activate/renew
 *
 * Body for POST:
 *   { action: 'SWITCH_TO_COMMISSION' }
 *   { action: 'ACTIVATE_FLAT'; billingCycle: 'MONTHLY' | 'YEARLY' }
 *
 * Trial: the first-ever FLAT activation on the MONTHLY cycle grants one free
 * month (no wallet charge), tracked once via `proTrialUsedAt`. The billing cron
 * charges the monthly fee when the free month ends (or downgrades to commission
 * if the wallet can't cover it).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
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
    billingCycle: z.enum(['MONTHLY', 'YEARLY']),
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
    /** True when the one-month free trial has not yet been consumed. */
    trialAvailable:           !inc.proTrialUsedAt,
    pricing,
    commissionRate:           cfg.commissionRate,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR']);
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
      // ACTIVATE_FLAT — activate the Pro plan, debiting the owner's wallet.
      //
      // First-ever activation on the MONTHLY cycle = one free trial month
      // (no charge). The free month always runs on a monthly cadence; the
      // billing cron charges the monthly fee when it ends. Choosing YEARLY
      // up-front is a normal paid activation (and consumes the trial slot).
      const pricing     = computeSubscriptionPricing(cfg);
      const isTrial     = !record.proTrialUsedAt && input.billingCycle === 'MONTHLY';
      const effectiveCycle = isTrial ? 'MONTHLY' : input.billingCycle;
      const paidAmount  = isTrial
        ? 0
        : effectiveCycle === 'YEARLY'
          ? pricing.yearlyAmount
          : pricing.monthlyAmount;
      const periodEnd   = computePeriodEnd(now, effectiveCycle);

      if (paidAmount > 0) {
        // Find the incubator owner's userId (by managerId or by email match)
        const ownerUser = (d.users ?? []).find(
          (u) => u.id === record.managerId || u.email === record.email,
        );
        if (!ownerUser) return 'NO_OWNER';

        const wallet = (d.wallets ?? []).find((w) => w.userId === ownerUser.id);
        if (!wallet || wallet.status === 'FROZEN') return 'WALLET_NOT_FOUND';
        if (wallet.balance < paidAmount) return 'INSUFFICIENT_FUNDS';

        // Debit the wallet
        wallet.balance  -= paidAmount;
        wallet.updatedAt = now;

        const tx = {
          id:            randomUUID(),
          walletId:      wallet.id,
          userId:        ownerUser.id,
          type:          'PAYMENT' as const,
          amount:        -paidAmount,
          balanceAfter:  wallet.balance,
          status:        'COMPLETED' as const,
          description:   `Pro subscription — ${effectiveCycle}`,
          reference:     `subscription-flat-${record.id}-${now}`,
          provider:      'internal',
          providerTxnId: null,
          metadata:      { incubatorId: record.id, billingCycle: effectiveCycle },
          createdAt:     now,
          completedAt:   now,
        };
        if (!Array.isArray(d.transactions)) d.transactions = [];
        d.transactions.push(tx);
      }

      record.subscriptionCode           = 'FLAT';
      record.billingCycle               = effectiveCycle;
      record.subscriptionStatus         = 'ACTIVE';
      record.subscriptionPeriodStart    = now;
      record.subscriptionPeriodEnd      = periodEnd;
      record.subscriptionLastPaidAmount = paidAmount;
      // Mark the trial consumed on the first-ever activation (any cycle).
      record.proTrialUsedAt             = record.proTrialUsedAt ?? now;
    }

    record.updatedAt = now;
    return record;
  });

  if (updated === 'NO_OWNER') return jsonError(422, 'NO_OWNER', 'Incubator owner account not found');
  if (updated === 'WALLET_NOT_FOUND') return jsonError(422, 'WALLET_NOT_FOUND', 'Wallet not found or frozen');
  if (updated === 'INSUFFICIENT_FUNDS') return jsonError(402, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance');
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
    trialAvailable:             !updated.proTrialUsedAt,
    pricing,
    commissionRate:             cfg.commissionRate,
  });
}
