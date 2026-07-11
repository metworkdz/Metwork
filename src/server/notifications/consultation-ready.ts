/**
 * "Session ready" notification for instant-book consultations — sent EXACTLY
 * ONCE per booking. Fired whenever a booking reaches READY (settlement with a
 * default meeting format, or the consultant supplying a link later). The
 * `linkSentAt` stamp is claimed atomically inside the store mutation, so
 * reaching READY more than once never re-notifies.
 *
 * Fully fire-and-forget: never throws into a caller, never blocks settlement.
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { sendConsultationReadyEmail } from '@/server/notifications/mock';
import { normalizeEmailLang } from '@/server/notifications/email';

export async function sendConsultationReadyOnce(bookingId: string): Promise<void> {
  // Claim the send: only when the booking is READY and hasn't notified yet.
  const claim = await db.update<{ booking: MentorBookingRecord } | null>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === bookingId);
    if (!booking) return null;
    if (booking.status !== 'READY') return null;
    if (booking.linkSentAt) return null;
    booking.linkSentAt = new Date().toISOString();
    return { booking };
  });
  if (!claim) return;

  const mentor = await findMentorById(claim.booking.mentorId);
  if (!mentor) return;
  // Localize to the CLIENT's SAVED profile locale (registered users) — the
  // authoritative source — falling back to the booking's request-time locale for
  // guests. Supports en/fr/ar (was en/fr only, ignoring the saved locale).
  const data = await db.read();
  const user = claim.booking.userId
    ? (data.users ?? []).find((u) => u.id === claim.booking.userId)
    : null;
  const lang = normalizeEmailLang(user?.locale ?? claim.booking.guestLocale);
  // Awaited: on Vercel the lambda freezes once the response is sent — an
  // unawaited send would be killed and the claim stamp burned with no email.
  await sendConsultationReadyEmail({ booking: claim.booking, mentor, lang });
}
