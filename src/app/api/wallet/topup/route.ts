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
import type { InitTopUpResponse } from '@/types/wallet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  return json(response, { status: 201 });
}
