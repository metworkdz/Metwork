/**
 * POST /api/withdrawals — request a wallet withdrawal
 * GET  /api/withdrawals — list the caller's withdrawal requests
 *
 * On POST the amount is immediately held in escrow (single balance path in
 * src/server/withdrawals/service.ts). The requester picks a method:
 *   bank_transfer / ccp — requires a saved payout account of the matching
 *                         type; it is snapshotted onto the request.
 *   cheque              — no account needed.
 * Legacy clients that send free-text `accountDetails` (no method) keep
 * working. Admin later approves (manual external transfer) or rejects
 * (wallet refunded).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession, requireApprovedApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendWithdrawalRequestedEmail } from '@/server/notifications/mock';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { track } from '@/lib/analytics';
import { createWithdrawalRequest } from '@/server/withdrawals/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    /** Integer DZD. Min 500, max 1 000 000. */
    amount: z.number().int().min(500).max(1_000_000),
    /** How the requester wants the funds. Absent = legacy free-text request. */
    method: z.enum(['bank_transfer', 'ccp', 'cheque']).optional(),
    /** Legacy free-text payment details. Required when no method is given. */
    accountDetails: z.string().min(5).max(500).optional(),
  })
  .refine((v) => v.method !== undefined || v.accountDetails !== undefined, {
    message: 'Either method or accountDetails is required',
    path: ['method'],
  });

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiSession();
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

  const result = await createWithdrawalRequest({
    targetType: 'user',
    targetId: guard.user.id,
    amount: input.amount,
    method: input.method ?? null,
    legacyAccountDetails: input.accountDetails,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'WALLET_FROZEN':
        return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
      case 'NO_PAYOUT_ACCOUNT':
        return jsonError(
          422,
          'NO_PAYOUT_ACCOUNT',
          result.requiredType === 'bank'
            ? 'Add a bank payout account (RIB) before requesting a bank transfer.'
            : 'Add a CCP payout account (RIP) before requesting a CCP transfer.',
          { requiredType: result.requiredType },
        );
      case 'MIN_BALANCE':
        return jsonError(
          422,
          'MIN_BALANCE',
          `As a monthly Pro incubator, you must keep at least ${result.minBalance.toLocaleString()} DZD (one month's subscription) in your wallet.`,
          { balance: result.balance, minBalance: result.minBalance },
        );
      case 'INSUFFICIENT_FUNDS':
        return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
          balance: result.available,
          required: result.required,
        });
      case 'BELOW_MINIMUM':
        return jsonError(422, 'BELOW_MINIMUM', `Minimum withdrawal is ${result.minimum} DZD.`);
      default:
        // INVALID_AMOUNT / INVALID_ACCOUNT_DETAILS / TARGET_NOT_FOUND — all
        // pre-validated above (zod + session), kept as a defensive fallback.
        return jsonError(422, 'INVALID_REQUEST', 'Invalid withdrawal request');
    }
  }

  await sendWithdrawalRequestedEmail(guard.user.email, {
    userName: guard.user.fullName ?? guard.user.email,
    amount: input.amount,
    accountDetails: result.request.accountDetails,
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
