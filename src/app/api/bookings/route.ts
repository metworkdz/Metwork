/**
 * POST /api/bookings  — create a space booking
 *
 * Atomically debits the caller's wallet and writes the booking record.
 * Idempotent on `clientReference` — the same key always returns the same
 * booking, so retries / double-clicks never double-charge.
 *
 * GET /api/bookings  — list the caller's bookings (newest first)
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { createSpaceBookingSchema } from '@/server/bookings/schemas';
import { createSpaceBooking, listBookingsForUser } from '@/server/bookings/service';
import { toBookingDto } from '@/server/bookings/serialize';
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
    input = createSpaceBookingSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await createSpaceBooking({
    userId: guard.user.id,
    spaceId: input.spaceId,
    unit: input.unit,
    quantity: input.quantity,
    startsAt: input.startsAt,
    clientReference: input.clientReference,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'SPACE_NOT_FOUND':
        return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
      case 'UNIT_NOT_AVAILABLE':
        return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', {
          available: result.available,
        });
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'Capacity exceeded', {
          capacity: result.capacity,
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
      transaction: toTransactionDto(result.transaction),
      wallet: toWalletDto(result.wallet),
      replayed: result.replayed,
    },
    { status: result.replayed ? 200 : 201 },
  );
}

export async function GET() {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const bookings = await listBookingsForUser(guard.user.id);
  return json({
    items: bookings.map(toBookingDto),
    total: bookings.length,
  });
}
