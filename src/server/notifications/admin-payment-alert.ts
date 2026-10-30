/**
 * Tell every admin that money just arrived. Sent once, by the caller that
 * claimed the settlement (replays never alert), after the money has moved.
 * Never throws: an alert problem must not undo or fail a settled payment.
 */
import { db } from '@/server/db/store';
import { notifyAdmins } from './notify-admins';

const dzd = (n: number) => `${n.toLocaleString('fr-DZ')} DZD`;

export async function alertAdminsOfBookingPayment(bookingId: string): Promise<void> {
  try {
    const d = await db.read();
    const b = d.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    const gross = b.onlineChargeAmount ?? b.onlinePaidAmount ?? 0;
    if (gross <= 0) return;
    const payer = (b.userId ? d.users.find((u) => u.id === b.userId)?.fullName : null) ?? b.clientName ?? 'Guest';
    const fee = (b.commissionAmount ?? 0) + (b.payerFeeAmount ?? 0);
    await notifyAdmins({
      type: 'PAYMENT_RECEIVED',
      title: `Payment received · ${dzd(gross)}`,
      body: `${b.itemName} — ${payer}. Metwork fee ${dzd(fee)}, paid to ${b.vendorName || 'the owner'}.`,
      href: '/dashboard/admin/payments',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] payment alert failed:', err instanceof Error ? err.message : err);
  }
}

export async function alertAdminsOfConsultationPayment(mentorBookingId: string): Promise<void> {
  try {
    const d = await db.read();
    const b = (d.mentorBookings ?? []).find((x) => x.id === mentorBookingId);
    if (!b) return;
    const gross = b.amountCharged ?? b.guestAmountDue ?? 0;
    if (gross <= 0) return;
    const mentor = (d.mentors ?? []).find((m) => m.id === b.mentorId);
    await notifyAdmins({
      type: 'PAYMENT_RECEIVED',
      title: `Payment received · ${dzd(gross)}`,
      body: `Consultation with ${mentor?.fullName ?? 'a consultant'} — ${b.userName}.`,
      href: '/dashboard/admin/payments',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] payment alert failed:', err instanceof Error ? err.message : err);
  }
}
