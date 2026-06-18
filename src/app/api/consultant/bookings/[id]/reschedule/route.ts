/**
 * POST /api/consultant/bookings/:id/reschedule  { date, time }
 *
 * The consultant moves one of their bookings to a new slot. Validated by the
 * shared bookable-slots validator, bounded by the reschedule cap + notice
 * window, and notifies the user. Ownership-enforced. No money changes.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { rescheduleBooking } from '@/server/consultations/reschedule';
import { rescheduleErrorResponse } from '@/server/consultations/reschedule-http';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Ownership: the booking must belong to the signed-in consultant.
  const data = await db.read();
  const booking = (data.mentorBookings ?? []).find((b) => b.id === id);
  if (!booking || booking.mentorId !== guard.mentorId) {
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }

  const result = await rescheduleBooking({ bookingId: id, by: 'consultant', date: input.date, time: input.time });
  if (!result.ok) return rescheduleErrorResponse(result.reason);

  return json({
    id: result.booking.id,
    status: result.booking.status,
    consultationDate: result.booking.consultationDate ?? null,
    consultationTime: result.booking.consultationTime ?? null,
    scheduledAt: result.booking.scheduledAt ?? null,
    rescheduleCount: result.booking.rescheduleCount ?? 0,
  });
}
