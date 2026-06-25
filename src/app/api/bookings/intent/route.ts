/**
 * POST /api/bookings/intent — PUBLIC.
 *
 * Persists a guest's public-space booking SELECTION (date/time + payment option)
 * so it survives the signup+OTP — or login — round trip. Holds NO price and NO
 * seat: the authoritative, server-priced card intent is created later at
 * `/api/bookings/intent/[id]/resume` once the visitor is authenticated.
 *
 * A courtesy validation (listing active, unit offered, surface accepted, working
 * hours, slot free) runs here so an obviously-bad selection is rejected early.
 * The BINDING availability re-check happens again at resume + settlement — the
 * client's earlier read is never trusted.
 *
 * Returns `{ id, expiresAt }`. Rate-limited per IP.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { unitPrice, validateWorkingHours, availableUnits } from '@/server/bookings/service';
import { checkSpaceAvailability } from '@/server/bookings/availability';
import { createBookingIntent } from '@/server/bookings/booking-intent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    spaceId: z.string().min(1),
    unit: z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    paymentMode: z.enum(['ONLINE_FULL', 'CASH_DEPOSIT']),
    splitHalf: z.boolean().optional(),
  })
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
    path: ['endsAt'],
    message: 'endAfterStart',
  });

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // 40 selections / IP / hour — generous for genuine browsing, throttles abuse.
  if (!(await checkRateLimitDistributed(`booking-intent:${ip}`, 40, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const data = await db.read();
  const space = (data.spaces ?? []).find((s) => s.id === input.spaceId);
  const incubatorActive =
    !!space && (data.incubators ?? []).some((i) => i.id === space.incubatorId && i.status === 'ACTIVE');
  if (!space || !space.isActive || !incubatorActive) {
    return jsonError(404, 'ITEM_NOT_FOUND', 'This listing is no longer available');
  }

  // Unit must be priced for the chosen surface (ONLINE_FULL → online price,
  // CASH_DEPOSIT → cash price), and the listing must accept that surface.
  if (unitPrice(space, input.unit, input.paymentMode) == null) {
    return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', {
      available: availableUnits(space),
    });
  }
  const needs = input.paymentMode === 'CASH_DEPOSIT' ? 'CASH' : 'ONLINE';
  if (!(space.acceptedPaymentMethods ?? ['ONLINE']).includes(needs)) {
    return jsonError(422, 'MODE_NOT_ACCEPTED', 'This payment option is not accepted for this listing');
  }

  const wh = validateWorkingHours(input.startsAt, input.endsAt, space);
  if (wh === 'NOT_A_WORKING_DAY') {
    return jsonError(422, 'NOT_A_WORKING_DAY', 'Selected day is not a working day', {
      workingDays: space.workingDays ?? [1, 2, 3, 4, 5],
    });
  }
  if (wh === 'OUTSIDE_WORKING_HOURS') {
    return jsonError(422, 'OUTSIDE_WORKING_HOURS', 'Booking is outside working hours', {
      openingTime: space.openingTime,
      closingTime: space.closingTime,
    });
  }

  // Courtesy availability gate (the binding one runs again at resume).
  const avail = checkSpaceAvailability({
    space,
    bookings: data.bookings ?? [],
    spaceId: space.id,
    unit: input.unit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
  if (!avail.ok) {
    if (avail.reason === 'DATE_UNAVAILABLE') {
      return jsonError(409, 'DATE_UNAVAILABLE', 'The selected date(s) are not available for booking', { blockedDates: avail.blockedDates });
    }
    if (avail.reason === 'OVERLAP_CONFLICT') {
      return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked', { conflictingBookingId: avail.conflictingBookingId });
    }
    return jsonError(409, 'CAPACITY_EXCEEDED', 'No seats remaining', { capacity: avail.capacity, taken: avail.taken });
  }

  const intent = await createBookingIntent({
    spaceId: space.id,
    unit: input.unit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    paymentMode: input.paymentMode,
    splitHalf: input.splitHalf,
  });

  return json({ id: intent.id, expiresAt: intent.expiresAt }, { status: 201 });
}
