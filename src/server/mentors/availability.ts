/**
 * Pure availability helpers for mentors.
 *
 * These functions own NO I/O — they operate entirely on records passed in
 * (a `MentorRecord` and the relevant `MentorBookingRecord[]`). That keeps
 * them deterministic and trivially unit-testable, and lets the public
 * read-only endpoint and any future UI share one source of truth.
 *
 * Model:
 *   - `weeklyAvailability` is a recurring template keyed by weekday
 *     (0 = Sunday … 6 = Saturday), each weekday holding zero or more
 *     "HH:MM"–"HH:MM" ranges in the mentor's local time.
 *   - `blockedDates` (YYYY-MM-DD) override the template — a blocked date has
 *     no available slots, regardless of the weekly template.
 *   - Existing bookings remove the slots they overlap. We count any booking
 *     that is not REJECTED (i.e. PENDING or APPROVED) as occupying its time,
 *     so a pending request tentatively holds the slot until an admin acts.
 *
 * All date math is anchored to UTC so the weekday of a "YYYY-MM-DD" string is
 * independent of the host machine's timezone (determinism over wall-clock).
 */
import type { MentorRecord, MentorBookingRecord } from '@/server/db/store';
import type { DaySlot } from '@/types/mentor';

/** Default per-booking duration (minutes) when a booking has a date but no explicit duration. */
const DEFAULT_BOOKING_MINUTES = 60;

/** Hard safety ceiling so a bad range can never iterate unbounded. */
const MAX_RANGE_DAYS = 366;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/** Parse "YYYY-MM-DD" → epoch ms at UTC midnight, or NaN if malformed. */
function dateToUtcMs(dateStr: string): number {
  if (!ISO_DATE_RE.test(dateStr)) return NaN;
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y!, m! - 1, d!);
  // Reject overflow (e.g. "2026-13-40") — Date.UTC silently rolls over.
  const back = utcMsToDate(ms);
  return back === dateStr ? ms : NaN;
}

/** Format an epoch-ms UTC instant back to "YYYY-MM-DD". */
function utcMsToDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Weekday for a "YYYY-MM-DD" date, 0 = Sunday … 6 = Saturday. NaN-safe (returns -1). */
export function weekdayOf(dateStr: string): number {
  const ms = dateToUtcMs(dateStr);
  return Number.isNaN(ms) ? -1 : new Date(ms).getUTCDay();
}

/** Minutes since midnight for "HH:MM", or NaN if malformed / out of range. */
function toMinutes(hhmm: string): number {
  if (!HHMM_RE.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  if (h! > 23 || m! > 59) return NaN;
  return h! * 60 + m!;
}

/** Half-open overlap test: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Occupied [startMin, endMin) intervals for a given mentor on a given date,
 * derived from non-rejected bookings. A booking with a date but no time is
 * treated as occupying the whole day.
 */
function bookedIntervalsFor(
  mentorId: string,
  date: string,
  bookings: readonly MentorBookingRecord[],
): Array<{ start: number; end: number }> {
  const intervals: Array<{ start: number; end: number }> = [];
  for (const b of bookings) {
    if (b.mentorId !== mentorId) continue;
    if (b.status === 'REJECTED') continue;
    if (b.consultationDate !== date) continue;

    const startMin = b.consultationTime ? toMinutes(b.consultationTime) : NaN;
    if (Number.isNaN(startMin)) {
      // No usable time → conservatively block the entire day.
      intervals.push({ start: 0, end: 24 * 60 });
      continue;
    }
    const dur = b.durationMinutes && b.durationMinutes > 0 ? b.durationMinutes : DEFAULT_BOOKING_MINUTES;
    intervals.push({ start: startMin, end: startMin + dur });
  }
  return intervals;
}

/**
 * Compute the concrete slots for a single date.
 *
 * Returns the weekly-template ranges for that weekday, each flagged
 * `available` = true unless the date is blocked or a booking overlaps it.
 * A blocked date returns its template slots all flagged unavailable (so a
 * UI can still show "this day exists but is closed"); an empty template
 * returns `[]`.
 */
export function computeDaySlots(
  mentor: Pick<MentorRecord, 'id' | 'weeklyAvailability' | 'blockedDates'>,
  date: string,
  bookings: readonly MentorBookingRecord[] = [],
): DaySlot[] {
  const wd = weekdayOf(date);
  if (wd < 0) return [];

  const dayTemplate = (mentor.weeklyAvailability ?? []).find((d) => d.weekday === wd);
  if (!dayTemplate || dayTemplate.slots.length === 0) return [];

  const isBlocked = (mentor.blockedDates ?? []).includes(date);
  const booked = isBlocked ? [] : bookedIntervalsFor(mentor.id, date, bookings);

  return dayTemplate.slots
    .map((s) => ({ s, start: toMinutes(s.start), end: toMinutes(s.end) }))
    // Drop malformed / non-positive ranges defensively.
    .filter(({ start, end }) => !Number.isNaN(start) && !Number.isNaN(end) && end > start)
    .sort((a, b) => a.start - b.start)
    .map(({ s, start, end }) => ({
      start: s.start,
      end: s.end,
      available: !isBlocked && !booked.some((iv) => overlaps(start, end, iv.start, iv.end)),
    }));
}

/**
 * Compute the list of dates (inclusive of `fromDate` and `toDate`) that have
 * at least one *available* slot — i.e. the weekly template minus blocked
 * dates minus dates whose every slot is taken by an existing booking.
 *
 * This helper is range-pure: it does NOT consult "today". Callers that want
 * to exclude the past should pass a `fromDate` clamped to today.
 */
export function computeAvailableDates(
  mentor: Pick<MentorRecord, 'id' | 'weeklyAvailability' | 'blockedDates'>,
  fromDate: string,
  toDate: string,
  bookings: readonly MentorBookingRecord[] = [],
): string[] {
  const fromMs = dateToUtcMs(fromDate);
  const toMs = dateToUtcMs(toDate);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return [];

  const DAY = 24 * 60 * 60 * 1000;
  const out: string[] = [];
  let count = 0;
  for (let ms = fromMs; ms <= toMs && count < MAX_RANGE_DAYS; ms += DAY, count++) {
    const date = utcMsToDate(ms);
    if (computeDaySlots(mentor, date, bookings).some((s) => s.available)) {
      out.push(date);
    }
  }
  return out;
}
