/**
 * Pre-session consultant reminders — driven by the consultation-reminders cron.
 *
 * Scans settled instant-book consultations (READY or AWAITING_LINK) whose
 * session starts within the next REMINDER_WINDOW_HOURS and emails the
 * CONSULTANT the meeting details (or an "add your meeting link" warning for
 * AWAITING_LINK — arguably the more important reminder). One reminder per
 * booking, ever: the `consultantReminderSentAt` stamp is claimed atomically in
 * a single store mutation, so overlapping cron runs never double-send.
 *
 * Schedule resolution mirrors the notification helpers: `scheduledAt` when
 * present, else consultationDate+consultationTime interpreted as
 * Africa/Algiers wall time (UTC+1 year-round — Algeria has no DST).
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { sendConsultantSessionReminderEmail } from '@/server/notifications/mock';

/** Remind when the session starts within this many hours. */
export const REMINDER_WINDOW_HOURS = 24;

/** States that still have a session ahead of them. */
const REMINDABLE = new Set(['READY', 'AWAITING_LINK']);

/**
 * Resolve a booking's session start as epoch ms, or null when no schedule is
 * recorded (nothing to remind about). Exported for tests.
 */
export function bookingStartMs(
  booking: Pick<MentorBookingRecord, 'scheduledAt' | 'consultationDate' | 'consultationTime'>,
): number | null {
  if (booking.scheduledAt) {
    const t = Date.parse(booking.scheduledAt);
    if (!Number.isNaN(t)) return t;
  }
  if (booking.consultationDate && booking.consultationTime) {
    // Algeria is UTC+1 with no DST, so the fixed offset is exact.
    const t = Date.parse(`${booking.consultationDate}T${booking.consultationTime}:00+01:00`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export interface ReminderRunResult {
  /** Bookings claimed by this run (reminder dispatched). */
  sent: number;
  /** Claimed bookings whose mentor record was missing (nothing sent). */
  skippedNoMentor: number;
}

/**
 * Claim + dispatch all due consultant reminders. Idempotent: a second run over
 * the same data claims nothing.
 */
export async function sendConsultationRemindersDue(now = new Date()): Promise<ReminderRunResult> {
  const nowMs = now.getTime();
  const horizonMs = nowMs + REMINDER_WINDOW_HOURS * 60 * 60_000;

  // Single atomic claim pass: stamp every due booking and collect it.
  const due = await db.update<MentorBookingRecord[]>((d) => {
    const claimed: MentorBookingRecord[] = [];
    for (const b of d.mentorBookings ?? []) {
      if (b.instantBook !== true) continue;
      if (!REMINDABLE.has(b.status)) continue;
      if (b.consultantReminderSentAt) continue;
      const startMs = bookingStartMs(b);
      if (startMs === null) continue;
      // Due = starts after now (not already past) and within the window.
      if (startMs <= nowMs || startMs > horizonMs) continue;
      b.consultantReminderSentAt = new Date(nowMs).toISOString();
      claimed.push(b);
    }
    return claimed;
  });

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const portalUrl = `${base}/mentordashboard`;

  let skippedNoMentor = 0;
  for (const booking of due) {
    const mentor = await findMentorById(booking.mentorId);
    if (!mentor) { skippedNoMentor++; continue; }
    sendConsultantSessionReminderEmail({ booking, mentor, portalUrl });
  }

  return { sent: due.length - skippedNoMentor, skippedNoMentor };
}
