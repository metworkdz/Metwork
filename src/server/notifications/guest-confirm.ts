/**
 * Post-payment confirmation for GUEST consultations — sent EXACTLY ONCE.
 *
 * Both the admin 0-amount approval (B3) and the public settlement route (B4)
 * route through here so the client receipt + mentor notice fire a single time.
 * The `confirmationEmailSentAt` timestamp is claimed atomically inside the
 * store mutation, so concurrent settlements / page re-verifications can never
 * double-send.
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import {
  sendConsultationConfirmationEmail,
  sendMentorSessionConfirmedEmail,
} from '@/server/notifications/mock';

export async function sendGuestConfirmationOnce(bookingId: string): Promise<void> {
  // Atomically claim the send. Only the caller that flips the flag from unset
  // to set proceeds; everyone else short-circuits.
  const claim = await db.update<{ booking: MentorBookingRecord } | null>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return null;
    if (booking.confirmationEmailSentAt) return null;
    booking.confirmationEmailSentAt = new Date().toISOString();
    return { booking };
  });
  if (!claim) return;

  const mentor = await findMentorById(claim.booking.mentorId);
  if (!mentor) return;

  const lang: 'en' | 'fr' = claim.booking.guestLocale === 'en' ? 'en' : 'fr';
  // Client gets the confirmation + PDF receipt; mentor gets the session notice.
  sendConsultationConfirmationEmail({ booking: claim.booking, mentor, lang });
  sendMentorSessionConfirmedEmail({ booking: claim.booking, mentor, lang });
}
