/**
 * POST /api/incubator/bookings/[id]/cancel-unpaid
 *
 * Cancel a booking that is still AWAITING PAYMENT (PENDING_PAYMENT). Allowed for
 * the owning incubator (and admin). Moves no money — an unpaid booking was never
 * charged. A booking that is already paid/settled is rejected (409 ALREADY_PAID)
 * and must be cancelled through the existing refund flow instead.
 *
 * The client is notified non-blocking (in-app + email) that no payment was taken.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { cancelUnpaidBooking } from '@/server/bookings/incubator-cancel';
import { notifyBookingCancelledUnpaid } from '@/server/notifications/booking-cancelled-unpaid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const result = await cancelUnpaidBooking({ bookingId: id, managerId: guard.user.id });

  if (!result.ok) {
    switch (result.reason) {
      case 'NO_INCUBATOR':
        return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
      case 'NOT_FOUND':
        return jsonError(404, 'NOT_FOUND', 'Booking not found');
      case 'FORBIDDEN':
        return jsonError(403, 'FORBIDDEN', 'Not your booking');
      case 'ALREADY_FINAL':
        return jsonError(409, 'ALREADY_FINAL', 'Booking is already cancelled');
      case 'ALREADY_PAID':
        return jsonError(
          409,
          'ALREADY_PAID',
          'This booking has been paid — cancel it through the refund flow instead.',
        );
    }
  }

  // Notify the client — fire-and-forget so a notification hiccup never affects
  // the cancellation outcome.
  void notifyBookingCancelledUnpaid(result.booking, result.client);

  return json({ booking: result.booking });
}
