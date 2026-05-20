/**
 * POST /api/withdrawals — request a wallet withdrawal
 * GET  /api/withdrawals — list the caller's withdrawal requests
 *
 * On POST: amount is immediately deducted from wallet (held in escrow).
 * Admin approves (external transfer, no further action needed in app)
 * or rejects (wallet refunded).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db, type TransactionRecord, type WithdrawalRequestRecord } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendWithdrawalRequestedEmail } from '@/server/notifications/mock';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { track } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  /** Integer DZD. Min 500, max 1 000 000. */
  amount: z.number().int().min(500).max(1_000_000),
  /** Free-text payment details (CCP / BaridiMob / bank account). Max 500 chars. */
  accountDetails: z.string().min(5).max(500),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  // Rate limit: 5 withdrawal requests per user per day. Withdrawals are
  // high-stakes (the amount is held in escrow until admin reviews), so
  // a compromised account spamming requests could trap a user's full
  // wallet balance in pending state. Five per day is more than any
  // legitimate user would ever need.
  if (!(await checkRateLimitDistributed(`withdrawals:user:${guard.user.id}`, 5, 24 * 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'You have reached the daily withdrawal-request limit. Please try again tomorrow.');
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = createSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await db.update((d) => {
    // Ensure wallet exists and has sufficient funds
    let wallet = d.wallets.find((w) => w.userId === guard.user.id);
    if (!wallet) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', balance: 0, required: input.amount } as const;
    }
    if (wallet.status === 'FROZEN') {
      return { ok: false, reason: 'WALLET_FROZEN' } as const;
    }
    if (wallet.balance < input.amount) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS', balance: wallet.balance, required: input.amount } as const;
    }

    const now = new Date().toISOString();

    // Deduct from wallet immediately (escrow)
    wallet.balance -= input.amount;
    wallet.updatedAt = now;

    const holdTx: TransactionRecord = {
      id: randomUUID(),
      walletId: wallet.id,
      userId: guard.user.id,
      type: 'PAYOUT',
      amount: -input.amount,
      balanceAfter: wallet.balance,
      status: 'PENDING',
      description: `Withdrawal request — ${input.amount.toLocaleString()} DZD`,
      reference: `withdrawal-hold-${randomUUID().slice(0, 8)}`,
      provider: 'internal',
      providerTxnId: null,
      metadata: { accountDetails: input.accountDetails },
      createdAt: now,
      completedAt: null,
    };
    d.transactions.push(holdTx);

    const request: WithdrawalRequestRecord = {
      id: randomUUID(),
      userId: guard.user.id,
      amount: input.amount,
      accountDetails: input.accountDetails,
      status: 'PENDING',
      holdTransactionId: holdTx.id,
      createdAt: now,
      updatedAt: now,
    };
    d.withdrawalRequests.push(request);

    return { ok: true, request, wallet } as const;
  });

  if (!result.ok) {
    if (result.reason === 'WALLET_FROZEN') {
      return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
    }
    return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
      balance: result.balance,
      required: result.required,
    });
  }

  sendWithdrawalRequestedEmail(guard.user.email, {
    userName: guard.user.fullName ?? guard.user.email,
    amount: input.amount,
    accountDetails: input.accountDetails,
  });

  // Analytics: withdrawal_requested is a key engagement signal for mentors
  // and incubator owners (the only roles that typically have payable balances).
  void track({
    event: 'withdrawal_requested',
    distinctId: guard.user.id,
    props: { amount: input.amount },
  });

  return json({ withdrawalRequest: result.request }, { status: 201 });
}

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const items = data.withdrawalRequests
    .filter((r) => r.userId === guard.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json({ items, total: items.length });
}
