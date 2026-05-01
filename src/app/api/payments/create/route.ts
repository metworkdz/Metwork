/**
 * POST /api/payments/create
 *
 * Creates a SlickPay transfer (or uses whatever provider is active),
 * persists the TopUpIntent in the DB, and returns the hosted-checkout URL.
 *
 * Response: { topUpId, paymentUrl, status }
 *
 * The client should redirect the user to `paymentUrl`. After payment,
 * SlickPay sends them back to /payment/success?topUpId={topUpId} where
 * the wallet is credited via /api/payments/status.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { initiateTopUp } from '@/server/wallet/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Integer DZD — minimum 100. */
  amount: z.number().int().min(100),
});

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
    input = bodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await initiateTopUp({
    userId: guard.user.id,
    amount: input.amount,
    // No returnUrl override — wallet service builds /payment/success?topUpId=…
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

  return json(
    {
      topUpId: result.topUp.id,
      paymentUrl: result.topUp.redirectUrl,
      status: result.topUp.status,
    },
    { status: 201 },
  );
}
