/**
 * Consultant space reservations.
 *
 *   GET  /api/consultant/space-bookings — this consultant's space reservations.
 *   POST /api/consultant/space-bookings — reserve a space (CASH, pay on site).
 *
 * Deliberately NOT `/api/consultant/bookings` — that path already serves the
 * consultant's *consultations* (mentorBookings), a different resource.
 *
 * Money model: none. The consultant reserves the seat here and pays the space
 * directly on site, so this route moves no money, touches no wallet and needs
 * no payment provider. The booking lands PENDING_PAYMENT / `manual`, exactly
 * like a platform user's cash booking, and the space collects on arrival.
 *
 * Everything about pricing, working hours, blackouts, capacity and desk holds
 * comes from the SAME canonical `createSpaceBooking` the main platform uses —
 * this route only supplies the booker identity.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { createSpaceBooking } from '@/server/bookings/service';
import { requireConsultant } from '@/server/mentors/access';
import { findMentorById } from '@/server/mentors/service';
import { findIncubatorById } from '@/server/incubator/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { notifyIncubatorNewBooking } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  spaceId: z.string().min(1),
  unit: z.enum(['HOUR', 'HALF_DAY', 'DAY', 'MONTH']),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  /** Idempotency key — a replay returns the original reservation. */
  clientReference: z.string().min(8).max(100),
  /** COWORKING / PRIVATE_OFFICE named unit, when the space uses them. */
  deskName: z.string().max(120).optional(),
});

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const data = await db.read();
  const items = (data.bookings ?? [])
    .filter((b) => b.mentorId === guard.mentorId && b.itemKind === 'SPACE')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => ({
      id: b.id,
      status: b.status,
      itemName: b.itemName,
      vendorName: b.vendorName,
      city: b.city,
      unit: b.unit,
      quantity: b.quantity,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      totalAmount: b.totalAmount,
      createdAt: b.createdAt,
    }));

  return json({ items });
}

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  // Reservations hold real seats, so bound runaway/abusive creation. Honest
  // retries are already free via the clientReference idempotency key.
  if (!(await checkRateLimitDistributed(`consultant-space-booking:${guard.mentorId}`, 30, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many reservations in a short period. Please wait a moment.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = createSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Consultant not found');

  const result = await createSpaceBooking({
    // Contact details are taken from the consultant's own record — never from
    // the request body, so a caller can't book under someone else's name.
    booker: {
      type: 'mentor',
      mentorId: guard.mentorId,
      contact: {
        fullName: mentor.fullName,
        email: mentor.email ?? null,
        phone: mentor.phone ?? null,
      },
    },
    spaceId: input.spaceId,
    unit: input.unit,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    clientReference: input.clientReference,
    // Cash-on-site is the only settlement path open to a consultant.
    paymentMethod: 'manual',
    deskName: input.deskName,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'SPACE_NOT_FOUND':
        return jsonError(404, 'SPACE_NOT_FOUND', 'Space not found');
      case 'CASH_NOT_ACCEPTED':
        return jsonError(422, 'CASH_NOT_ACCEPTED', 'This space does not accept payment on site');
      case 'CONSULTANT_CASH_ONLY':
        return jsonError(422, 'CONSULTANT_CASH_ONLY', 'Consultants can only reserve spaces that are paid on site');
      case 'UNIT_NOT_AVAILABLE':
        return jsonError(422, 'UNIT_NOT_AVAILABLE', 'Selected billing unit is not available', { available: result.available });
      case 'DATE_UNAVAILABLE':
        return jsonError(422, 'DATE_UNAVAILABLE', 'The selected date(s) are not available', { blockedDates: result.blockedDates });
      case 'CAPACITY_EXCEEDED':
        return jsonError(409, 'CAPACITY_EXCEEDED', 'This space is fully booked for that slot', { capacity: result.capacity, taken: result.taken });
      case 'OVERLAP_CONFLICT':
        return jsonError(409, 'OVERLAP_CONFLICT', 'This time slot is already booked', { conflictingBookingId: result.conflictingBookingId });
      case 'OUTSIDE_WORKING_HOURS':
        return jsonError(422, 'OUTSIDE_WORKING_HOURS', `Booking must be between ${result.openingTime} and ${result.closingTime}`, { openingTime: result.openingTime, closingTime: result.closingTime });
      case 'NOT_A_WORKING_DAY':
        return jsonError(422, 'NOT_A_WORKING_DAY', 'Selected day is not a working day', { workingDays: result.workingDays });
      default:
        return jsonError(400, 'BOOKING_FAILED', 'Could not create the reservation');
    }
  }

  // Tell the space a reservation landed — email + WhatsApp, exactly the alert a
  // platform user's cash booking sends. Fire-and-forget inside a catch: a failed
  // notification must never undo a confirmed reservation.
  if (!result.replayed) {
    void (async () => {
      try {
        const data = await db.read();
        const space = (data.spaces ?? []).find((s) => s.id === input.spaceId);
        const incubator = space ? await findIncubatorById(space.incubatorId) : null;
        if (!incubator) return;
        await notifyIncubatorNewBooking(incubator, {
          customerName: `${mentor.fullName} (consultant)`,
          itemName: result.booking.itemName,
          startsAt: result.booking.startsAt,
          endsAt: result.booking.endsAt,
          totalAmount: result.booking.totalAmount,
          // Cash reservation — the space still has to confirm and collect.
          actionNeeded: true,
          lang: 'fr',
        });
      } catch { /* notification failures never affect the reservation */ }
    })();
  }

  return json(
    {
      booking: {
        id: result.booking.id,
        status: result.booking.status,
        itemName: result.booking.itemName,
        vendorName: result.booking.vendorName,
        city: result.booking.city,
        unit: result.booking.unit,
        quantity: result.booking.quantity,
        startsAt: result.booking.startsAt,
        endsAt: result.booking.endsAt,
        totalAmount: result.booking.totalAmount,
        createdAt: result.booking.createdAt,
      },
      replayed: result.replayed,
    },
    { status: result.replayed ? 200 : 201 },
  );
}
