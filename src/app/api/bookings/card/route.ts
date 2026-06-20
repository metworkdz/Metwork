/**
 * POST /api/bookings/card
 *
 * PUBLIC (optional session). Creates a PENDING_PAYMENT card-booking intent for a
 * SPACE / PROGRAM / EVENT — for BOTH guests and registered clients who pay by
 * card (CIB / Edahabia via hosted checkout) rather than the Metwork wallet.
 *
 *   - ONLINE_FULL  → the client pays the whole total online now.
 *   - CASH_DEPOSIT → the client pays a deposit online now; the balance is paid
 *                    in cash on-site to the incubator.
 *
 * Security: the client NEVER supplies a price. T / D / C are recomputed
 * server-side in `createCardBookingIntent`. The membership discount is derived
 * here from the session (0 for guests), never trusted from the body. The intent
 * holds NO seat; capacity is re-checked at settlement. Idempotent on
 * (userId, clientReference). Rate-limited per IP.
 *
 * Returns `{ token, payPath }` — the browser is sent to the hosted-checkout
 * pay page at `payPath`, which lazily creates the provider transfer.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { readSession } from '@/server/auth/session';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { createCardBookingSchema } from '@/server/bookings/schemas';
import { createCardBookingIntent } from '@/server/bookings/card-payment';
import { guestCheckoutAllowedFor } from '@/server/bookings/status';
import {
  getSpaceDiscountForUser,
  getEventDiscountForUser,
} from '@/server/memberships/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // 30 intents / IP / hour. Idempotency on clientReference covers honest
  // retries; this throttles abuse / runaway scripts probing the endpoint.
  if (!(await checkRateLimitDistributed(`booking-card:${ip}`, 30, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createCardBookingSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Identify the caller. Registered → server-derive the membership discount;
  // guest → 0. We never trust a userId or discount from the request body.
  const ctx = await readSession();
  const userId = ctx?.user.id ?? null;

  // Guest checkout is allowed ONLY for programs. Spaces, events and
  // consultations require a Metwork account and must pass through Metwork
  // payments — bounce guests to login (the UI returns them to the booking).
  if (!userId && !guestCheckoutAllowedFor(input.target.itemKind)) {
    return jsonError(401, 'LOGIN_REQUIRED', 'Please sign in to complete this booking.');
  }
  let membershipDiscount = 0;
  if (userId) {
    if (input.target.itemKind === 'SPACE') {
      membershipDiscount = await getSpaceDiscountForUser(userId);
    } else if (input.target.itemKind === 'EVENT') {
      membershipDiscount = await getEventDiscountForUser(userId);
    }
    // PROGRAM: no membership discount tier today.
  }

  const result = await createCardBookingIntent({
    target: input.target,
    paymentMode: input.paymentMode,
    userId,
    customer: input.customer,
    clientReference: input.clientReference,
    promoCode: input.promoCode ?? null,
    membershipDiscount,
    locale: input.locale ?? ctx?.user.locale ?? 'fr',
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'ITEM_NOT_FOUND':
        return jsonError(404, 'ITEM_NOT_FOUND', 'This listing is no longer available');
      case 'MODE_NOT_ACCEPTED':
        return jsonError(422, 'MODE_NOT_ACCEPTED', 'This payment option is not accepted for this listing');
      case 'DEPOSIT_NOT_CONFIGURED':
        return jsonError(422, 'DEPOSIT_NOT_CONFIGURED', 'A cash deposit is not configured for this listing');
      case 'INVALID_DEPOSIT_CONFIG':
        return jsonError(422, 'INVALID_DEPOSIT_CONFIG', 'The cash deposit configuration is invalid');
      case 'INVALID_TOTAL':
        return jsonError(422, 'INVALID_TOTAL', 'This listing has no payable amount');
      case 'UNIT_NOT_AVAILABLE':
        return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', result.detail);
      case 'OUTSIDE_WORKING_HOURS':
        return jsonError(422, 'OUTSIDE_WORKING_HOURS', 'Booking is outside working hours', result.detail);
      case 'NOT_A_WORKING_DAY':
        return jsonError(422, 'NOT_A_WORKING_DAY', 'Selected day is not a working day', result.detail);
      case 'DATE_UNAVAILABLE':
        return jsonError(422, 'DATE_UNAVAILABLE', 'The selected date(s) are not available for booking', result.detail);
      case 'OVERLAP_CONFLICT':
        return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked', result.detail);
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'No seats remaining', result.detail);
      case 'DEADLINE_PASSED':
        return jsonError(409, 'DEADLINE_PASSED', 'The application deadline has passed', result.detail);
      case 'EVENT_PASSED':
        return jsonError(409, 'EVENT_PASSED', 'This event has already taken place', result.detail);
      case 'ALREADY_BOOKED':
        return jsonError(409, 'ALREADY_BOOKED', 'You already have an active booking for this listing', result.detail);
      default:
        return jsonError(400, 'BOOKING_FAILED', 'Could not create the booking');
    }
  }

  const localeSeg = result.booking.bookingLocale ?? input.locale ?? 'fr';
  const payPath = `/${localeSeg}/booking/pay/${result.token}`;
  return json(
    { token: result.token, payPath, replayed: result.replayed },
    { status: result.replayed ? 200 : 201 },
  );
}
