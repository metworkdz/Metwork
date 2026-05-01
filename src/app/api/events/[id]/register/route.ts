/**
 * POST /api/events/:id/register
 *
 * Same shape and atomicity guarantees as `/api/programs/:id/apply` —
 * just for events. Free events skip the wallet (no zero-DZD ledger row).
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { registerForEventSchema } from '@/server/bookings/schemas';
import { registerForEvent } from '@/server/bookings/service';
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

  const { id: eventId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = registerForEventSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await registerForEvent({
    userId: guard.user.id,
    eventId,
    clientReference: input.clientReference,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'EVENT_NOT_FOUND':
        return jsonError(404, 'EVENT_NOT_FOUND', 'Event not found');
      case 'EVENT_PASSED':
        return jsonError(409, 'EVENT_PASSED', 'Event has already happened', {
          eventDate: result.eventDate,
        });
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'Event is full', {
          capacity: result.capacity,
          taken: result.taken,
        });
      case 'ALREADY_REGISTERED':
        return jsonError(409, 'ALREADY_REGISTERED', "You're already registered for this event", {
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
