/**
 * POST /api/consultant/bookings/:id/link  { mode, link? }
 *
 * The consultant provides (or updates) the meeting format for one of their
 * bookings, moving AWAITING_LINK → READY. Ownership-enforced.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { setBookingMeetingLink } from '@/server/consultations/lifecycle';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  mode: z.enum(['ONLINE', 'OFFLINE']),
  link: z.string().url().max(500).optional().nullable(),
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

  const result = await setBookingMeetingLink({ bookingId: id, mode: input.mode, link: input.link ?? null });
  if (!result.ok) {
    if (result.reason === 'LINK_REQUIRED') return jsonError(422, 'LINK_REQUIRED', 'A meeting link is required for an online session');
    if (result.reason === 'WRONG_STATE') return jsonError(409, 'WRONG_STATE', 'This booking cannot accept a meeting link in its current state');
    return jsonError(404, 'NOT_FOUND', 'Booking not found');
  }
  return json({ id: result.booking.id, status: result.booking.status, meetingMode: result.booking.meetingMode, meetingLink: result.booking.meetingLink });
}
