/**
 * "New booking" notification to the CONSULTANT — sent EXACTLY ONCE per booking.
 * Fired whenever an instant-book consultation settles (paid/CONFIRMED), whether
 * it lands READY or AWAITING_LINK. The `bookingNotifiedAt` stamp is claimed
 * atomically inside the store mutation, so re-processing a settled booking never
 * re-notifies.
 *
 * Fully fire-and-forget: never throws into a caller, never blocks settlement.
 * Distinct from `sendConsultationReadyOnce` (the CLIENT meeting-details notice,
 * deduped via `linkSentAt`).
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { sendConsultantNewBookingEmail } from '@/server/notifications/mock';

export async function sendBookingNotificationOnce(bookingId: string): Promise<void> {
  // Claim the send: only a settled (paid) instant-book booking, not yet notified.
  const claim = await db.update<{ booking: MentorBookingRecord } | null>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return null;
    // Instant-book only — legacy/admin-approval bookings never notify here.
    if (booking.instantBook !== true) return null;
    // 'PAID' is the settled marker set at every settlement point (zero-amount,
    // member wallet, member top-up, guest pay).
    if (booking.paymentStatus !== 'PAID') return null;
    if (booking.bookingNotifiedAt) return null;
    booking.bookingNotifiedAt = new Date().toISOString();
    return { booking };
  });
  if (!claim) return;

  const mentor = await findMentorById(claim.booking.mentorId);
  if (!mentor) return;

  // Link the consultant to their PIN-gated portal (where the client PII lives).
  // Notifications default to French (locked product decision).
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const portalUrl = `${base}/fr/consultant`;
  sendConsultantNewBookingEmail({ booking: claim.booking, mentor, portalUrl, lang: 'fr' });
}
