/**
 * Notify a client that their UNPAID (awaiting-payment) booking was cancelled by
 * the provider. Two channels: in-app (registered users) + email (anyone with an
 * address). Localised by the booking's locale. Fully fire-and-forget — never
 * throws into the cancel path.
 *
 * Distinct from the declined-booking notice: an unpaid booking was never
 * charged, so the copy makes clear NO payment was taken and there is no refund.
 */
import type { BookingRecord } from '@/server/db/store';
import { createNotification } from './create-notification';
import { sendBookingCancelledUnpaidEmail } from './mock';

type Lang = 'en' | 'fr' | 'ar';

function pickLang(l?: string | null): Lang {
  return l === 'fr' || l === 'ar' ? l : 'en';
}

const IN_APP: Record<Lang, (item: string) => { title: string; body: string }> = {
  en: (i) => ({
    title: 'Booking cancelled',
    body: `Your unpaid booking for “${i}” was cancelled by the provider. No payment was taken.`,
  }),
  fr: (i) => ({
    title: 'Réservation annulée',
    body: `Votre réservation non payée pour « ${i} » a été annulée par le prestataire. Aucun paiement n’a été prélevé.`,
  }),
  ar: (i) => ({
    title: 'تم إلغاء الحجز',
    body: `تم إلغاء حجزك غير المدفوع لـ "${i}" من قِبل مزوّد الخدمة. لم يتم تحصيل أي دفعة.`,
  }),
};

export async function notifyBookingCancelledUnpaid(
  booking: Pick<
    BookingRecord,
    'id' | 'userId' | 'itemName' | 'vendorName' | 'bookingLocale'
  >,
  client: { name: string; email: string | null },
): Promise<void> {
  try {
    const lang = pickLang(booking.bookingLocale);
    const copy = IN_APP[lang](booking.itemName);

    if (booking.userId) {
      await createNotification({
        userId: booking.userId,
        type: 'BOOKING_CANCELLED',
        title: copy.title,
        body: copy.body,
        href: '/dashboard/entrepreneur/bookings',
      });
    }

    if (client.email) {
      sendBookingCancelledUnpaidEmail(
        client.email,
        {
          customerName: client.name,
          bookingId: booking.id,
          itemName: booking.itemName,
          vendorName: booking.vendorName,
        },
        lang,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] notifyBookingCancelledUnpaid failed:', err);
  }
}
