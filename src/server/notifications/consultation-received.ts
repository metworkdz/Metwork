/**
 * "Request received" acknowledgment to the CLIENT — sent EXACTLY ONCE per
 * booking. Fired at the creation/settlement points where the client would
 * otherwise hear NOTHING at booking time:
 *   • member settlement that lands AWAITING_LINK (no meeting default — the
 *     session-ready email only comes later, when the consultant adds a link),
 *   • guest booking creation (PENDING_PAYMENT — the pay flow follows).
 * READY settlements are NOT acknowledged here: the session-ready email (full
 * meeting details) already goes out immediately and is the acknowledgment.
 *
 * The `requestReceivedEmailSentAt` stamp is claimed atomically inside the
 * store mutation, so replays/re-settlements never re-notify. Fully
 * fire-and-forget: never throws into a caller, never blocks booking creation.
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { sendConsultationRequestReceivedEmail } from '@/server/notifications/mock';

export async function sendConsultationReceivedOnce(bookingId: string): Promise<void> {
  const claim = await db.update<{ booking: MentorBookingRecord } | null>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return null;
    // READY bookings get the session-ready email instead — never both.
    if (booking.status === 'READY') return null;
    if (booking.requestReceivedEmailSentAt) return null;
    booking.requestReceivedEmailSentAt = new Date().toISOString();
    return { booking };
  });
  if (!claim) return;

  const mentor = await findMentorById(claim.booking.mentorId);
  if (!mentor) return;
  const lang: 'en' | 'fr' = claim.booking.guestLocale === 'en' ? 'en' : 'fr';
  sendConsultationRequestReceivedEmail({ booking: claim.booking, mentor, lang });
}
