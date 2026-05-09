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
import { getSpaceDiscountForUser } from '@/server/memberships/service';
import { validatePromoCode, consumePromoCode } from '@/server/promo-codes/service';
import {
  sendBookingPendingEmail,
  sendNewBookingAlert,
} from '@/server/notifications/mock';
import { db } from '@/server/db/store';

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

  // ── Membership discount (STARTUP tier gets 20% off spaces) ───────────────
  const membershipDiscount = await getSpaceDiscountForUser(guard.user.id);

  // ── Promo code discount (stacks additively, capped at 100%) ──────────────
  let promoDiscount = 0;
  if (input.promoCode) {
    const promoResult = await validatePromoCode(input.promoCode);
    if (!promoResult.valid) {
      const msg: Record<string, string> = {
        NOT_FOUND: 'Promo code not found',
        INACTIVE: 'Promo code is no longer active',
        EXPIRED: 'Promo code has expired',
        LIMIT_REACHED: 'Promo code has reached its usage limit',
      };
      return jsonError(422, 'INVALID_PROMO_CODE', msg[promoResult.reason] ?? 'Invalid promo code');
    }
    if (promoResult.promoCode.appliesTo !== 'ALL' && promoResult.promoCode.appliesTo !== 'SPACE') {
      return jsonError(422, 'INVALID_PROMO_CODE', 'This promo code does not apply to space bookings');
    }
    promoDiscount = promoResult.discountPercent;
  }

  const totalDiscountPercent = Math.min(100, membershipDiscount * 100 + promoDiscount);

  const result = await createSpaceBooking({
    userId: guard.user.id,
    spaceId: input.spaceId,
    unit: input.unit,
    quantity: input.quantity,
    startsAt: input.startsAt,
    clientReference: input.clientReference,
    discountPercent: totalDiscountPercent,
  });

  // Consume promo code if booking succeeded
  if (result.ok && input.promoCode) {
    await consumePromoCode(input.promoCode);
  }

  if (!result.ok) {
    switch (result.reason) {
      case 'SPACE_NOT_FOUND':
        return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
      case 'UNIT_NOT_AVAILABLE':
        return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', {
          available: result.available,
        });
      case 'DATE_UNAVAILABLE':
        return jsonError(422, 'DATE_UNAVAILABLE', 'The selected date(s) are not available for booking', {
          blockedDates: result.blockedDates,
        });
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'Capacity exceeded', {
          capacity: result.capacity,
          taken: result.taken,
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

  // Fire-and-forget notifications on new bookings (not replays)
  if (!result.replayed) {
    const booking = result.booking;
    // Pending confirmation email to user
    sendBookingPendingEmail(guard.user.email, {
      customerName: guard.user.fullName,
      bookingId: booking.id,
      itemName: booking.itemName,
      itemKind: booking.itemKind,
      vendorName: booking.vendorName,
      city: booking.city,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      totalAmount: booking.totalAmount,
      createdAt: booking.createdAt,
    });
    // New-booking alert to incubator
    void (async () => {
      try {
        const data = await db.read();
        const incubator = data.incubators.find((i) => i.name === booking.vendorName);
        if (incubator?.managerId) {
          const manager = data.users.find((u) => u.id === incubator.managerId);
          if (manager) {
            sendNewBookingAlert(manager.email, manager.phone, {
              incubatorName: incubator.name,
              customerName: guard.user.fullName,
              bookingId: booking.id,
              itemName: booking.itemName,
              itemKind: booking.itemKind,
              startsAt: booking.startsAt,
              endsAt: booking.endsAt,
              totalAmount: booking.totalAmount,
            });
          }
        }
      } catch {
        // non-critical — swallow
      }
    })();
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
