/**
 * POST /api/bookings/intent/[id]/resume — AUTH REQUIRED.
 *
 * Resumes a public-space guest selection once the visitor is authenticated (just
 * finished signup+OTP, or logged in). It re-reads the stored selection and hands
 * off to the existing `createCardBookingIntent`, which:
 *   - re-validates availability against LIVE data (the slot may have been taken
 *     mid-flow → we surface a clean "pick another slot" error),
 *   - recomputes the price server-side and applies the now-known member's
 *     discount (never trusting any client-supplied amount),
 *   - returns a single-use pay token.
 *
 * The browser is then sent to the hosted-checkout pay page. Idempotent: the card
 * intent is keyed on `(userId, intent:<id>)`, so a double-submit / back-forward
 * replays the same booking instead of creating a second one.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { readSession } from '@/server/auth/session';
import { getValidBookingIntent, consumeBookingIntent } from '@/server/bookings/booking-intent';
import { createCardBookingIntent } from '@/server/bookings/card-payment';
import { getSpaceDiscountForUser } from '@/server/memberships/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ctx = await readSession();
  if (!ctx?.user) {
    return jsonError(401, 'LOGIN_REQUIRED', 'Please sign in to complete this booking.');
  }
  const user = ctx.user;
  const locale = user.locale ?? 'fr';
  const clientReference = `intent:${id}`;
  const payPathFor = (token: string, seg: string) => `/${seg}/booking/pay/${token}`;

  // Replay guard: a booking already created from this intent → return its pay
  // page (covers double-submit / back-forward after the intent was consumed).
  const replay = (await db.read()).bookings.find(
    (b) => b.userId === user.id && b.clientReference === clientReference && b.payToken,
  );
  if (replay) {
    await consumeBookingIntent(id);
    return json({ payPath: payPathFor(replay.payToken!, replay.bookingLocale ?? locale) });
  }

  const intent = await getValidBookingIntent(id);
  if (!intent) {
    return jsonError(410, 'BOOKING_INTENT_EXPIRED', 'This booking selection has expired. Please pick your slot again.');
  }

  const membershipDiscount = await getSpaceDiscountForUser(user.id);
  const result = await createCardBookingIntent({
    target: {
      itemKind: 'SPACE',
      spaceId: intent.spaceId,
      unit: intent.unit,
      startsAt: intent.startsAt,
      endsAt: intent.endsAt,
    },
    paymentMode: intent.paymentMode,
    splitHalf: intent.splitHalf,
    userId: user.id,
    customer: { fullName: user.fullName, email: user.email, phone: user.phone },
    clientReference,
    promoCode: null,
    membershipDiscount,
    locale,
  });

  if (!result.ok) {
    // The slot may have been taken / blocked since the selection was made.
    if (
      result.reason === 'DATE_UNAVAILABLE' ||
      result.reason === 'OVERLAP_CONFLICT' ||
      result.reason === 'CAPACITY_EXCEEDED'
    ) {
      await consumeBookingIntent(id);
      return jsonError(409, 'SLOT_UNAVAILABLE', 'This slot is no longer available. Please pick another slot.', result.detail);
    }
    if (result.reason === 'ITEM_NOT_FOUND') {
      await consumeBookingIntent(id);
      return jsonError(404, 'ITEM_NOT_FOUND', 'This listing is no longer available', result.detail);
    }
    return jsonError(422, result.reason, 'Could not resume this booking', result.detail);
  }

  await consumeBookingIntent(id);
  return json({ payPath: payPathFor(result.token, result.booking.bookingLocale ?? locale) });
}
