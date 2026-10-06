/**
 * POST /api/incubator/bookings/[id]/cancel-reservation[?notify=true]
 *
 * Cancel a reservation the host recorded themselves (a desk sale or walk-in).
 * It holds the desk, so it cannot be deleted until it is cancelled — this is the
 * missing "cancel it first" step. Moves no money; releases the desk/seat.
 *
 * Silence is the default: the client is emailed only when the host asks
 * (`?notify=true`) and an address is on file, the same rule as deleting.
 * Online bookings that were paid are refused (409 NOT_MANUAL) — they reverse
 * real wallet entries and keep their own refund flow.
 */
import type { NextRequest } from 'next/server';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { cancelManualBooking } from '@/server/bookings/incubator-cancel';
import { sendBookingProviderCancelledEmail } from '@/server/notifications/mock';
import { createNotification } from '@/server/notifications/create-notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // INCUBATOR only: ownership is resolved from the signed-in manager, so an
  // admin session has no incubator to act as here.
  const guard = await requireApprovedApiRole(['INCUBATOR']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const notifyAsked = new URL(req.url).searchParams.get('notify') === 'true';

  const result = await cancelManualBooking({ bookingId: id, managerId: guard.user.id });

  if (!result.ok) {
    switch (result.reason) {
      case 'NO_INCUBATOR':
        return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');
      case 'NOT_FOUND':
        return jsonError(404, 'NOT_FOUND', 'Booking not found');
      case 'ALREADY_FINAL':
        return jsonError(409, 'ALREADY_FINAL', 'Booking is already cancelled');
      case 'NOT_MANUAL':
        return jsonError(
          409,
          'NOT_MANUAL',
          'This booking was paid online. Cancel it through the refund flow instead.',
        );
      case 'NOT_CANCELLABLE':
        return jsonError(409, 'NOT_CANCELLABLE', 'This booking cannot be cancelled from here.');
    }
  }

  if (notifyAsked && result.client.email) {
    // Awaited: a serverless lambda can freeze right after the response and drop floating work.
    await sendBookingProviderCancelledEmail(
      result.client.email,
      {
        customerName: result.client.name,
        bookingId: result.booking.id,
        itemName: result.booking.itemName,
        vendorName: result.booking.vendorName,
      },
      'fr',
    );
    if (result.userId) {
      await createNotification({
        userId: result.userId,
        type: 'BOOKING_CANCELLED',
        title: 'Reservation cancelled',
        body: `Your reservation for "${result.booking.itemName}" was cancelled by the host.`,
        href: '/dashboard/entrepreneur/bookings',
      });
    }
  }

  // Never echo a payment-link credential back (none exists on a manual booking, but the
  // record is shared, so strip it rather than rely on that).
  const { paymentLinkTokenHash: _omit, ...booking } = result.booking;
  void _omit;
  return json({ ok: true, booking });
}
