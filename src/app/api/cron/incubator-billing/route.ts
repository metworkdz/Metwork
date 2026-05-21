/**
 * Vercel Cron — Recurring incubator Pro (FLAT) billing.
 *
 * Schedule: `0 2 * * *` (02:00 UTC daily). Each run processes every FLAT
 * subscription whose paid period has elapsed (`subscriptionPeriodEnd <= now`):
 *
 *   • MONTHLY cycle — debit the monthly fee from the owner's wallet and renew
 *     for another month. If the wallet is missing / frozen / underfunded, the
 *     incubator is downgraded to COMMISSION (pay-as-you-go). The free trial
 *     month also runs on this cadence, so an unpaid trial auto-downgrades here.
 *   • YEARLY cycle — annual payers are NOT auto-charged; the lapsed period is
 *     simply marked EXPIRED (effective plan already reverts to commission).
 *
 * Secured by `CRON_SECRET` env var — same pattern as `/api/cron/process-downgrades`.
 */
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/server/db/store';
import { getPlatformConfig } from '@/server/incubator/service';

export const runtime = 'nodejs';

function isCronAuthorised(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'test') return true;
    return false;
  }
  return req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

function missingCronSecret(): Response {
  return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 501 });
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
  const nowIso = now.toISOString();
  const cfg = await getPlatformConfig();
  const monthlyFee = cfg.flatMonthlyPrice;

  let charged = 0;
  let downgraded = 0;
  let expired = 0;
  const errors: string[] = [];

  await db.update((d) => {
    for (const inc of d.incubators ?? []) {
      if (inc.subscriptionCode !== 'FLAT') continue;
      if (inc.subscriptionStatus !== 'ACTIVE') continue;
      if (!inc.subscriptionPeriodEnd) continue;
      if (new Date(inc.subscriptionPeriodEnd) > now) continue; // period still running

      try {
        // Annual payers are not auto-charged — just mark the lapsed period expired.
        if (inc.billingCycle !== 'MONTHLY') {
          inc.subscriptionStatus = 'EXPIRED';
          inc.updatedAt = nowIso;
          expired++;
          continue;
        }

        // Monthly cycle — attempt to debit the owner's wallet for the next month.
        const ownerUser = (d.users ?? []).find(
          (u) => u.id === inc.managerId || u.email === inc.email,
        );
        const wallet = ownerUser
          ? (d.wallets ?? []).find((w) => w.userId === ownerUser.id)
          : undefined;

        const canCharge =
          !!ownerUser &&
          !!wallet &&
          wallet.status !== 'FROZEN' &&
          wallet.balance >= monthlyFee;

        if (!canCharge) {
          // Insufficient funds / no wallet / frozen → revert to pay-as-you-go.
          inc.subscriptionCode = 'COMMISSION';
          inc.billingCycle = null;
          inc.subscriptionStatus = 'EXPIRED';
          inc.subscriptionLastPaidAmount = null;
          inc.updatedAt = nowIso;
          downgraded++;
          continue;
        }

        // Debit and renew for one more month.
        wallet.balance -= monthlyFee;
        wallet.updatedAt = nowIso;

        if (!Array.isArray(d.transactions)) d.transactions = [];
        d.transactions.push({
          id: randomUUID(),
          walletId: wallet.id,
          userId: ownerUser.id,
          type: 'PAYMENT',
          amount: -monthlyFee,
          balanceAfter: wallet.balance,
          status: 'COMPLETED',
          description: 'Pro subscription — MONTHLY (auto-renewal)',
          reference: `subscription-flat-renew-${inc.id}-${nowIso}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: { incubatorId: inc.id, billingCycle: 'MONTHLY', auto: true },
          createdAt: nowIso,
          completedAt: nowIso,
        });

        const nextEnd = new Date(now);
        nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
        inc.subscriptionPeriodStart = nowIso;
        inc.subscriptionPeriodEnd = nextEnd.toISOString();
        inc.subscriptionLastPaidAmount = monthlyFee;
        inc.subscriptionStatus = 'ACTIVE';
        inc.updatedAt = nowIso;
        charged++;
      } catch (err) {
        const msg = `Failed to bill incubator ${inc.id}: ${String(err)}`;
        errors.push(msg);
        console.error('[cron] incubator-billing error', { incubatorId: inc.id, err });
      }
    }
  });

  const durationMs = Date.now() - startedAt;
  console.info('[cron] incubator-billing: finished', {
    charged,
    downgraded,
    expired,
    errorCount: errors.length,
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    charged,
    downgraded,
    expired,
    timestamp: nowIso,
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

  const now = new Date();
  const data = await db.read();
  const due = (data.incubators ?? []).filter(
    (inc) =>
      inc.subscriptionCode === 'FLAT' &&
      inc.subscriptionStatus === 'ACTIVE' &&
      inc.subscriptionPeriodEnd != null &&
      new Date(inc.subscriptionPeriodEnd) <= now,
  );
  return NextResponse.json({ ok: true, dueCount: due.length });
}
