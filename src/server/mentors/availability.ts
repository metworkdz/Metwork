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
import type { MentorRecord, MentorBookingRecord, MentorSlotLockRecord } from '@/server/db/store';
import type { DaySlot, BookableSlot } from '@/types/mentor';

/** Default per-booking duration (minutes) when a booking has a date but no explicit duration. */
const DEFAULT_BOOKING_MINUTES = 60;

/** Engine defaults applied when a mentor leaves the booking-policy fields unset. */
const DEFAULT_MIN_NOTICE_HOURS = 24;
const DEFAULT_BUFFER_MINUTES = 0;
const DEFAULT_TIMEZONE = 'Africa/Algiers';

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

/* ════════════════════════════════════════════════════════════════════════
 * Shared bookable-slots validator (single source of truth)
 *
 * `computeBookableSlots` is the one function the public booking route, the
 * consultant's own view, and reschedule are meant to call. On top of the
 * weekly template it subtracts:
 *   − existing bookings (non-REJECTED / non-CANCELLED), padded by bufferMinutes
 *   − active slot-locks (held at payment initiation), padded by bufferMinutes
 *   − the min-notice window: slots starting before now + minNoticeHours
 *
 * Like the helpers above it owns no I/O — records (bookings, locks, now) are
 * passed in, keeping it deterministic and unit-testable.
 * ════════════════════════════════════════════════════════════════════════ */

/** Mentor fields the bookable-slots validator reads. */
type BookablePolicyMentor = Pick<
  MentorRecord,
  | 'id'
  | 'weeklyAvailability'
  | 'blockedDates'
  | 'availabilityTimezone'
  | 'minNoticeHours'
  | 'bufferMinutes'
>;

export interface BookableSlotsOptions {
  /** Override "now" (epoch ms) for testability. Defaults to Date.now(). */
  nowMs?: number;
  /** Active slot-locks (any mentor) — filtered to this mentor + unexpired internally. */
  slotLocks?: readonly MentorSlotLockRecord[];
}

/** Minutes-of-day offset of a wall-clock "HH:MM" on `dateStr` in `timeZone`, as a UTC instant (ms). */
function zonedWallToUtcMs(dateStr: string, hhmm: string, timeZone: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  // Two-pass offset resolution handles DST boundaries for arbitrary IANA zones.
  const o1 = tzOffsetMs(guess, timeZone);
  const o2 = tzOffsetMs(guess - o1, timeZone);
  return guess - o2;
}

/**
 * Convert a mentor-local slot (date + "HH:MM" in `timeZone`) to a UTC ISO
 * instant. Shared so reschedule / booking write a `scheduledAt` that agrees
 * with what `computeBookableSlots` reasons about. Returns null on malformed
 * input. `timeZone` defaults to the engine default.
 */
export function slotToUtcIso(date: string, hhmm: string, timeZone?: string): string | null {
  if (!ISO_DATE_RE.test(date) || !HHMM_RE.test(hhmm)) return null;
  const ms = zonedWallToUtcMs(date, hhmm, timeZone || DEFAULT_TIMEZONE);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Offset (ms) of `timeZone` from UTC at the given instant. Unknown tz ⇒ 0 (treat as UTC). */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const map: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24, // some engines render midnight as "24"
      Number(map.minute),
      Number(map.second),
    );
    return asUTC - utcMs;
  } catch {
    return 0;
  }
}

/** Occupied [start,end) minute intervals for a date, padded by buffer on both sides. */
function occupiedIntervals(
  mentorId: string,
  date: string,
  bookings: readonly MentorBookingRecord[],
  slotLocks: readonly MentorSlotLockRecord[],
  nowMs: number,
  buffer: number,
): Array<{ start: number; end: number }> {
  const raw: Array<{ start: number; end: number }> = [];

  for (const b of bookings) {
    if (b.mentorId !== mentorId) continue;
    if (b.status === 'REJECTED' || b.status === 'CANCELLED') continue;
    if (b.consultationDate !== date) continue;
    const startMin = b.consultationTime ? toMinutes(b.consultationTime) : NaN;
    if (Number.isNaN(startMin)) {
      raw.push({ start: 0, end: 24 * 60 });
      continue;
    }
    const dur = b.durationMinutes && b.durationMinutes > 0 ? b.durationMinutes : DEFAULT_BOOKING_MINUTES;
    raw.push({ start: startMin, end: startMin + dur });
  }

  for (const lock of slotLocks) {
    if (lock.mentorId !== mentorId) continue;
    if (lock.date !== date) continue;
    if (new Date(lock.expiresAt).getTime() <= nowMs) continue; // expired ⇒ released
    const startMin = toMinutes(lock.startTime);
    if (Number.isNaN(startMin)) continue;
    const dur = lock.durationMinutes > 0 ? lock.durationMinutes : DEFAULT_BOOKING_MINUTES;
    raw.push({ start: startMin, end: startMin + dur });
  }

  return raw.map((iv) => ({ start: iv.start - buffer, end: iv.end + buffer }));
}

/**
 * Compute every concrete slot in [fromDate, toDate] flagged `available`. A slot
 * is available when: the date isn't blocked, no padded booking/lock overlaps it,
 * AND it starts at or after `now + minNoticeHours`.
 */
export function computeBookableSlots(
  mentor: BookablePolicyMentor,
  fromDate: string,
  toDate: string,
  bookings: readonly MentorBookingRecord[] = [],
  options: BookableSlotsOptions = {},
): BookableSlot[] {
  const fromMs = dateToUtcMs(fromDate);
  const toMs = dateToUtcMs(toDate);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) return [];

  const nowMs = options.nowMs ?? Date.now();
  const slotLocks = options.slotLocks ?? [];
  const tz = mentor.availabilityTimezone || DEFAULT_TIMEZONE;
  const minNotice = mentor.minNoticeHours != null ? mentor.minNoticeHours : DEFAULT_MIN_NOTICE_HOURS;
  const buffer = mentor.bufferMinutes != null ? mentor.bufferMinutes : DEFAULT_BUFFER_MINUTES;
  const earliestMs = nowMs + Math.max(0, minNotice) * 60 * 60 * 1000;

  const DAY = 24 * 60 * 60 * 1000;
  const out: BookableSlot[] = [];
  let count = 0;
  for (let ms = fromMs; ms <= toMs && count < MAX_RANGE_DAYS; ms += DAY, count++) {
    const date = utcMsToDate(ms);
    const wd = weekdayOf(date);
    if (wd < 0) continue;

    const dayTemplate = (mentor.weeklyAvailability ?? []).find((d) => d.weekday === wd);
    if (!dayTemplate || dayTemplate.slots.length === 0) continue;

    const isBlocked = (mentor.blockedDates ?? []).includes(date);
    const occupied = isBlocked
      ? []
      : occupiedIntervals(mentor.id, date, bookings, slotLocks, nowMs, Math.max(0, buffer));

    const ranges = dayTemplate.slots
      .map((s) => ({ s, start: toMinutes(s.start), end: toMinutes(s.end) }))
      .filter(({ start, end }) => !Number.isNaN(start) && !Number.isNaN(end) && end > start)
      .sort((a, b) => a.start - b.start);

    for (const { s, start, end } of ranges) {
      const startMs = zonedWallToUtcMs(date, s.start, tz);
      const available =
        !isBlocked &&
        startMs >= earliestMs &&
        !occupied.some((iv) => overlaps(start, end, iv.start, iv.end));
      out.push({ date, start: s.start, end: s.end, available });
    }
  }
  return out;
}
