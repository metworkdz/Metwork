/**
 * Pre-session reminders — driven by the consultation-reminders cron.
 *
 * Two passes over settled instant-book consultations, each with its own
 * atomic one-shot claim so overlapping cron runs never double-send:
 *   • CONSULTANT (24h before, READY or AWAITING_LINK): the meeting details, or
 *     an "add your meeting link" warning — arguably the more important nudge.
 *     Claim stamp: `consultantReminderSentAt`.
 *   • CLIENT (1h before, READY only — a reminder without meeting details would
 *     just confuse): email + WhatsApp→SMS with the link / address.
 *     Claim stamp: `clientReminderSentAt`.
 *
 * Schedule resolution mirrors the notification helpers: `scheduledAt` when
 * present, else consultationDate+consultationTime interpreted as
 * Africa/Algiers wall time (UTC+1 year-round — Algeria has no DST).
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import {
  sendConsultantSessionReminderEmail,
  sendClientSessionReminderEmail,
} from '@/server/notifications/mock';

/** Remind the CONSULTANT when the session starts within this many hours. */
export const REMINDER_WINDOW_HOURS = 24;
/** Remind the CLIENT when the session starts within this many hours. */
export const CLIENT_REMINDER_WINDOW_HOURS = 1;

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
  /** Consultant reminders dispatched by this run. */
  sent: number;
  /** Client 1h reminders dispatched by this run. */
  clientSent: number;
  /** Claimed bookings whose mentor record was missing (nothing sent). */
  skippedNoMentor: number;
}

/**
 * Claim + dispatch all due reminders (consultant 24h pass + client 1h pass).
 * Idempotent: a second run over the same data claims nothing. Every send is
 * awaited — the cron lambda must not return before delivery.
 */
export async function sendConsultationRemindersDue(now = new Date()): Promise<ReminderRunResult> {
  const nowMs = now.getTime();
  const consultantHorizonMs = nowMs + REMINDER_WINDOW_HOURS * 60 * 60_000;
  const clientHorizonMs = nowMs + CLIENT_REMINDER_WINDOW_HOURS * 60 * 60_000;

  // Single atomic claim pass: stamp every due booking (both passes) and
  // collect who to notify.
  const due = await db.update<{ consultant: MentorBookingRecord[]; client: MentorBookingRecord[] }>((d) => {
    const claimed = { consultant: [] as MentorBookingRecord[], client: [] as MentorBookingRecord[] };
    for (const b of d.mentorBookings ?? []) {
      if (b.instantBook !== true) continue;
      if (!REMINDABLE.has(b.status)) continue;
      const startMs = bookingStartMs(b);
      if (startMs === null || startMs <= nowMs) continue;

      if (!b.consultantReminderSentAt && startMs <= consultantHorizonMs) {
        b.consultantReminderSentAt = new Date(nowMs).toISOString();
        claimed.consultant.push(b);
      }
      // Client pass: READY only — the reminder's whole point is the link/address.
      if (!b.clientReminderSentAt && b.status === 'READY' && startMs <= clientHorizonMs) {
        b.clientReminderSentAt = new Date(nowMs).toISOString();
        claimed.client.push(b);
      }
    }
    return claimed;
  });

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const portalUrl = `${base}/mentordashboard`;

  let sent = 0;
  let clientSent = 0;
  let skippedNoMentor = 0;

  for (const booking of due.consultant) {
    const mentor = await findMentorById(booking.mentorId);
    if (!mentor) { skippedNoMentor++; continue; }
    await sendConsultantSessionReminderEmail({ booking, mentor, portalUrl });
    sent++;
  }
  for (const booking of due.client) {
    const mentor = await findMentorById(booking.mentorId);
    if (!mentor) { skippedNoMentor++; continue; }
    const lang: 'en' | 'fr' = booking.guestLocale === 'en' ? 'en' : 'fr';
    await sendClientSessionReminderEmail({ booking, mentor, lang });
    clientSent++;
  }

  return { sent, clientSent, skippedNoMentor };
}
