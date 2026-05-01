/**
 * POST /api/wallet/payments
 *
 * Debit the caller's wallet for an internal platform purchase
 * (booking, program enrollment, etc.). Idempotent on `reference` —
 * replaying the same request returns the original transaction without
 * double-spending.
 *
 * In the future this will be wrapped by the booking flow, which will
 * also credit the destination (incubator wallet) and book the platform
 * commission inside the same critical section.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { chargeWallet } from '@/server/wallet/service';
import { chargeWalletSchema } from '@/server/wallet/schemas';
import { toTransactionDto, toWalletDto } from '@/server/wallet/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

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
    input = chargeWalletSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await chargeWallet({
    userId: guard.user.id,
    amount: input.amount,
    description: input.description,
    reference: input.reference,
    metadata: input.metadata,
  });

  if (!result.ok) {
    if (result.reason === 'INSUFFICIENT_FUNDS') {
      return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
        balance: result.balance,
        required: result.required,
      });
    }
    if (result.reason === 'WALLET_FROZEN') {
      return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
    }
    return jsonError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
  }

  return json(
    {
      transaction: toTransactionDto(result.transaction),
      wallet: toWalletDto(result.wallet),
      replayed: result.replayed,
    },
    { status: result.replayed ? 200 : 201 },
  );
}
