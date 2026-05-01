/**
 * GET /api/events/:id/status
 *
 * Public attendance + caller's registration status. See
 * `/api/programs/[id]/status` for the same pattern.
 */
import { findEventById } from '@/server/bookings/event-catalog';
import { getEventAttendance } from '@/server/bookings/service';
import { readSession } from '@/server/auth/session';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const event = await findEventById(id);
  if (!event) return jsonError(404, 'EVENT_NOT_FOUND', 'Event not found');

  const session = await readSession();
  const att = await getEventAttendance(id, session?.user.id);

  return json({
    eventId: id,
    capacity: event.capacity,
    taken: att.taken,
    eventDate: event.eventDate,
    eventPassed: Date.parse(event.eventDate) <= Date.now(),
    mine: att.mine
      ? { bookingId: att.mine.id, status: att.mine.status, createdAt: att.mine.createdAt }
      : null,
  });
}
