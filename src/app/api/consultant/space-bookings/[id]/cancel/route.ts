/**
 * POST /api/consultant/space-bookings/:id/cancel
 *
 * Cancel a space reservation the consultant made. No money is involved (these
 * are always cash holds), so this is available at any time.
 *
 * Session-guarded and ownership-scoped inside the service: a consultant can
 * only cancel a reservation carrying their own mentorId.
 */
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { findMentorById } from '@/server/mentors/service';
import { cancelConsultantSpaceBooking } from '@/server/bookings/consultant-cancel';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { createNotification } from '@/server/notifications/create-notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await cancelConsultantSpaceBooking({ bookingId: id, mentorId: guard.mentorId });

  if (!result.ok) {
    switch (result.reason) {
      case 'NOT_FOUND':     return jsonError(404, 'NOT_FOUND', 'Reservation not found');
      case 'FORBIDDEN':     return jsonError(403, 'FORBIDDEN', 'This reservation is not yours to cancel');
      case 'ALREADY_FINAL': return jsonError(409, 'ALREADY_FINAL', 'This reservation is already cancelled');
    }
  }

  // Let the space know the room is free again. Fire-and-forget inside a catch:
  // a failed notification must never undo a completed cancellation.
  void (async () => {
    try {
      const data = await db.read();
      const space = (data.spaces ?? []).find((s) => s.id === result.booking.itemId);
      const incubator = space
        ? (data.incubators ?? []).find((i) => i.id === space.incubatorId)
        : null;
      if (!incubator?.managerId) return;
      const mentor = await findMentorById(guard.mentorId);
      await createNotification({
        userId: incubator.managerId,
        type: 'BOOKING_CANCELLED',
        title: 'Reservation cancelled',
        body: `${mentor?.fullName ?? 'A consultant'} cancelled their reservation for "${result.booking.itemName}". No payment was due.`,
        href: '/dashboard/incubator/bookings',
      });
    } catch { /* notification failures never affect the cancellation */ }
  })();

  return json({ id: result.booking.id, status: result.booking.status });
}
