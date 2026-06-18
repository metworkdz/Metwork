/**
 * Bidirectional consultation reschedule (P3).
 *
 * BOTH the consultant and the user may move a settled, not-yet-completed
 * consultation to a new slot, subject to three guards:
 *   • Notice window — too late to move once the CURRENT session is within the
 *     consultant's `minNoticeHours` lead time.
 *   • Reschedule cap — at most `MAX_RESCHEDULES` moves per booking.
 *   • Slot validity — the NEW slot must pass the shared `computeBookableSlots`
 *     validator (template − bookings − buffer − notice − locks), evaluated
 *     atomically inside the store mutation so two concurrent moves can't collide.
 *
 * Reschedule NEVER changes money — it is the same paid booking at a new time.
 * On success the OTHER party is notified (fire-and-forget, non-blocking).
 */
import { db, type MentorBookingRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { computeBookableSlots, slotToUtcIso } from '@/server/mentors/availability';
import { sendConsultationRescheduledEmail } from '@/server/notifications/mock';

/** Default maximum reschedules per booking (owner default = 2). */
export const MAX_RESCHEDULES = 2;
const DEFAULT_MIN_NOTICE_HOURS = 24;

/** Settled, not-yet-completed states a booking can be moved from. */
const RESCHEDULABLE = new Set<MentorBookingRecord['status']>(['READY', 'AWAITING_LINK', 'CONFIRMED']);

export type RescheduleResult =
  | { ok: true; booking: MentorBookingRecord; notify: 'user' | 'consultant' }
  | {
      ok: false;
      reason:
        | 'NOT_FOUND'
        | 'NOT_INSTANT_BOOK'
        | 'WRONG_STATE'
        | 'LIMIT_REACHED'
        | 'TOO_LATE'
        | 'SLOT_NOT_BOOKABLE';
    };

/** Current session start (epoch ms) from scheduledAt, or naive date+time. Null if unknown. */
function sessionStartMs(
  b: Pick<MentorBookingRecord, 'scheduledAt' | 'consultationDate' | 'consultationTime'>,
): number | null {
  if (b.scheduledAt) {
    const t = new Date(b.scheduledAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (b.consultationDate && b.consultationTime) {
    const t = new Date(`${b.consultationDate}T${b.consultationTime}:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export async function rescheduleBooking(input: {
  bookingId: string;
  by: 'consultant' | 'user';
  /** New slot "YYYY-MM-DD". */
  date: string;
  /** New slot start "HH:MM" (mentor local time — a template-slot start). */
  time: string;
}): Promise<RescheduleResult> {
  // Pre-read to resolve the mentor (its availability template is the validator
  // input and doesn't change inside the mutation).
  const pre = await db.read();
  const existing = (pre.mentorBookings ?? []).find((b) => b.id === input.bookingId);
  if (!existing) return { ok: false, reason: 'NOT_FOUND' };
  if (existing.instantBook !== true) return { ok: false, reason: 'NOT_INSTANT_BOOK' };
  if (!RESCHEDULABLE.has(existing.status)) return { ok: false, reason: 'WRONG_STATE' };

  const mentor = await findMentorById(existing.mentorId);
  if (!mentor) return { ok: false, reason: 'NOT_FOUND' };
  const minNotice = mentor.minNoticeHours != null ? mentor.minNoticeHours : DEFAULT_MIN_NOTICE_HOURS;
  const newScheduledAt =
    slotToUtcIso(input.date, input.time, mentor.availabilityTimezone) ??
    `${input.date}T${input.time}:00`;

  const result = await db.update<RescheduleResult>((d) => {
    const booking = (d.mentorBookings ?? []).find((b) => b.id === input.bookingId);
    if (!booking) return { ok: false, reason: 'NOT_FOUND' };
    if (booking.instantBook !== true) return { ok: false, reason: 'NOT_INSTANT_BOOK' };
    if (!RESCHEDULABLE.has(booking.status)) return { ok: false, reason: 'WRONG_STATE' };
    if ((booking.rescheduleCount ?? 0) >= MAX_RESCHEDULES) return { ok: false, reason: 'LIMIT_REACHED' };

    // Notice window — can't move once the current session is within notice.
    const startMs = sessionStartMs(booking);
    if (startMs != null && startMs - Date.now() < Math.max(0, minNotice) * 3_600_000) {
      return { ok: false, reason: 'TOO_LATE' };
    }

    // Validate the NEW slot, excluding this booking's own current occupancy so a
    // same-day move doesn't self-conflict. Race-safe (inside the mutation).
    const others = (d.mentorBookings ?? []).filter(
      (b) => b.mentorId === booking.mentorId && b.id !== booking.id,
    );
    const slots = computeBookableSlots(mentor, input.date, input.date, others, {
      slotLocks: d.mentorSlotLocks ?? [],
    });
    const bookable = slots.some(
      (s) => s.date === input.date && s.start === input.time && s.available,
    );
    if (!bookable) return { ok: false, reason: 'SLOT_NOT_BOOKABLE' };

    const now = new Date().toISOString();
    const from = {
      date: booking.consultationDate ?? null,
      time: booking.consultationTime ?? null,
      scheduledAt: booking.scheduledAt ?? null,
    };
    booking.consultationDate = input.date;
    booking.consultationTime = input.time;
    booking.scheduledAt = newScheduledAt;
    booking.rescheduleCount = (booking.rescheduleCount ?? 0) + 1;
    booking.rescheduledAt = now;
    if (!Array.isArray(booking.rescheduleHistory)) booking.rescheduleHistory = [];
    booking.rescheduleHistory.push({
      from,
      to: { date: input.date, time: input.time, scheduledAt: newScheduledAt },
      by: input.by,
      at: now,
    });
    booking.updatedAt = now;
    // Re-notify the client when a session is moved (it's effectively a new READY).
    booking.linkSentAt = null;

    const notify: 'user' | 'consultant' = input.by === 'consultant' ? 'user' : 'consultant';
    return { ok: true, booking, notify };
  });

  if (result.ok) {
    const lang: 'en' | 'fr' = result.booking.guestLocale === 'en' ? 'en' : 'fr';
    try {
      sendConsultationRescheduledEmail({ booking: result.booking, mentor, lang, to: result.notify });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[reschedule] notify failed for booking ${result.booking.id} (rescheduled OK):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return result;
}
