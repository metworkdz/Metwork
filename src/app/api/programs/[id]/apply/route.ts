/**
 * POST /api/programs/:id/apply
 *
 * Atomically charges the program fee from the caller's wallet (free
 * programs skip the wallet entirely) and writes a CONFIRMED booking
 * with `itemKind: 'PROGRAM'`. Idempotent on `clientReference`, deduped
 * on (userId, programId).
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { applyToProgramSchema } from '@/server/bookings/schemas';
import { applyToProgram } from '@/server/bookings/service';
import { toBookingDto } from '@/server/bookings/serialize';
import { toTransactionDto, toWalletDto } from '@/server/wallet/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: programId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = applyToProgramSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await applyToProgram({
    userId: guard.user.id,
    programId,
    clientReference: input.clientReference,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'PROGRAM_NOT_FOUND':
        return jsonError(404, 'PROGRAM_NOT_FOUND', 'Program not found');
      case 'DEADLINE_PASSED':
        return jsonError(409, 'DEADLINE_PASSED', 'Application deadline has passed', {
          deadline: result.deadline,
        });
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'Program is full', {
          capacity: result.capacity,
          taken: result.taken,
        });
      case 'ALREADY_APPLIED':
        return jsonError(409, 'ALREADY_APPLIED', "You've already applied to this program", {
          existingBookingId: result.existingBookingId,
        });
      case 'WALLET_FROZEN':
        return jsonError(409, 'WALLET_FROZEN', 'Wallet is frozen');
      case 'INSUFFICIENT_FUNDS':
        return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
          balance: result.balance,
          required: result.required,
        });
    }
  }

  return json(
    {
      booking: toBookingDto(result.booking),
      transaction: result.transaction ? toTransactionDto(result.transaction) : null,
      wallet: toWalletDto(result.wallet),
      replayed: result.replayed,
    },
    { status: result.replayed ? 200 : 201 },
  );
}
