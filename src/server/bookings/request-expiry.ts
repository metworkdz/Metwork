/**
 * Expiry sweep for REQUEST-mode ("Request to Book") reservations.
 *
 * Two idempotent transitions, both to CANCELLED (no separate EXPIRED status):
 *   - AWAITING_APPROVAL older than APPROVAL_TTL_HOURS  → declineReason 'approval_expired'
 *   - APPROVED_UNPAID past paymentLinkExpiresAt        → declineReason 'payment_expired'
 *
 * No money ever moved on these states, so expiring them releases the
 * soft-held seat (and any desk holds) without any wallet movement. Safe to
 * run repeatedly — already-terminal bookings are skipped by the status guard,
 * and the pay endpoint independently rejects expired links, so cron latency
 * is cleanup latency, never a security hole.
 */
import { db } from '@/server/db/store';
import { APPROVAL_TTL_HOURS } from './request-mode';
import { sendBookingCancelledUnpaidEmail } from '@/server/notifications/mock';
import { createNotification } from '@/server/notifications/create-notification';

interface ExpiredBookingNotice {
  userId: string | null;
  email: string;
  customerName: string;
  bookingId: string;
  itemName: string;
  vendorName: string;
  locale: 'en' | 'fr' | 'ar';
  reason: 'approval_expired' | 'payment_expired';
}

export async function sweepExpiredRequestBookings(): Promise<{ expired: number }> {
  const now = Date.now();
  const approvalCutoff = new Date(now - APPROVAL_TTL_HOURS * 3_600_000).toISOString();

  const notices = await db.update<ExpiredBookingNotice[]>((d) => {
    const out: ExpiredBookingNotice[] = [];
    for (const booking of d.bookings) {
      if (booking.reservationMode !== 'REQUEST' || booking.paidAt) continue;

      let reason: ExpiredBookingNotice['reason'] | null = null;
      if (booking.status === 'AWAITING_APPROVAL' && booking.createdAt < approvalCutoff) {
        reason = 'approval_expired';
      } else if (
        booking.status === 'APPROVED_UNPAID' &&
        booking.paymentLinkExpiresAt &&
        Date.parse(booking.paymentLinkExpiresAt) < now
      ) {
        reason = 'payment_expired';
      }
      if (!reason) continue;

      const nowIso = new Date().toISOString();
      booking.status = 'CANCELLED';
      booking.declineReason = reason;
      booking.updatedAt = nowIso;
      // Release desk/office holds so the availability calendar frees up.
      for (const desk of d.deskBookings ?? []) {
        if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') {
          desk.status = 'CANCELLED';
        }
      }

      const user = booking.userId ? d.users.find((u) => u.id === booking.userId) : null;
      out.push({
        userId: booking.userId,
        email: user?.email ?? booking.clientEmail ?? '',
        customerName: user?.fullName ?? booking.clientName ?? 'Client',
        bookingId: booking.id,
        itemName: booking.itemName,
        vendorName: booking.vendorName,
        locale: user?.locale === 'en' ? 'en' : user?.locale === 'ar' ? 'ar' : 'fr',
        reason,
      });
    }
    return out;
  });

  // Non-blocking notifications — a send failure never affects the sweep.
  for (const n of notices) {
    try {
      if (n.email) {
        sendBookingCancelledUnpaidEmail(n.email, {
          customerName: n.customerName,
          bookingId: n.bookingId,
          itemName: n.itemName,
          vendorName: n.vendorName,
        }, n.locale);
      }
      if (n.userId) {
        await createNotification({
          userId: n.userId,
          type: 'BOOKING_CANCELLED',
          title: n.reason === 'approval_expired' ? 'Booking request expired' : 'Payment window expired',
          body:
            n.reason === 'approval_expired'
              ? `Your booking request for "${n.itemName}" expired without a response from the host. Nothing was charged.`
              : `The payment window for "${n.itemName}" expired and the reservation was released. Nothing was charged.`,
          href: '/dashboard/entrepreneur/bookings',
        });
      }
    } catch {
      // notifications only — swallow
    }
  }

  return { expired: notices.length };
}
