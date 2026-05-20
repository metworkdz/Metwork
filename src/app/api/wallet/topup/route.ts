/**
 * POST /api/wallet/topup
 *
 * Initiates a wallet top-up via the active payment provider.
 * Response shape:
 *   { topUpId, status: 'PENDING' | 'COMPLETED', redirectUrl, balance }
 *
 * For the mock provider in default (sync) mode, status comes back as
 * COMPLETED and the new balance is returned right away. For an async
 * provider (e.g. SlickPay) status is PENDING and the client should
 * navigate the user to redirectUrl.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { initiateTopUp } from '@/server/wallet/service';
import { initTopUpSchema } from '@/server/wallet/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { track } from '@/lib/analytics';
import type { InitTopUpResponse } from '@/types/wallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  // Rate limit: 10 top-up attempts per user per hour. Top-ups are a deliberate
  // user action — abuse here means someone is hammering the payment provider,
  // which costs money even when the eventual charge fails. Generous enough
  // for users retrying after a card decline or provider hiccup.
  if (!(await checkRateLimitDistributed(`wallet-topup:user:${guard.user.id}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many top-up attempts. Please wait a few minutes.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = initTopUpSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await initiateTopUp({
    userId: guard.user.id,
    amount: input.amount,
    returnUrl: input.returnUrl,
    customer: {
      fullName: guard.user.fullName,
      email: guard.user.email,
      phone: guard.user.phone,
    },
  });

  if (!result.ok) {
    if (result.reason === 'AMOUNT_OUT_OF_RANGE') {
      return jsonError(422, 'AMOUNT_OUT_OF_RANGE', 'Amount out of range', {
        min: result.min,
        max: result.max,
      });
    }
    if (result.reason === 'WALLET_FROZEN') {
      return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
    }
    return jsonError(502, 'PROVIDER_FAILED', result.message);
  }

  const response: InitTopUpResponse = {
    topUpId: result.topUp.id,
    status: result.topUp.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
    redirectUrl: result.topUp.redirectUrl,
    balance: result.topUp.status === 'COMPLETED' ? result.wallet.balance : null,
  };

  // Analytics: track top-up initiation. We fire on both PENDING and COMPLETED
  // so the funnel captures dropoff between "started checkout" and "money landed".
  // The webhook handler should track 'wallet_topup' again on COMPLETED for async
  // providers — that's deduped naturally by PostHog using the topUpId in event id.
  void track({
    event: 'wallet_topup',
    distinctId: guard.user.id,
    props: {
      amount: input.amount,
      provider: result.topUp.provider,
      status: response.status,
    },
  });

  return json(response, { status: 201 });
}
