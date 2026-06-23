/**
 * space-availability-view — pure, client-safe adapter over the canonical public
 * availability read (`GET /api/spaces/:id/availability?from&to`, see
 * `computeUnavailableIntervals`). It turns the server's already-computed
 * `intervals[]` into what a month-grid calendar renders:
 *
 *   • per-day info (working / past / has-booking / has-block / selectable), and
 *   • per-day hourly `DaySlot[]` for the time picker.
 *
 * IT CONTAINS NO BOOKING RULES. The authoritative "can this window be booked?"
 * gate is `checkSpaceAvailability` on the server; this module only interprets the
 * intervals that gate's read-twin produced, so a user who bypasses the UI still
 * hits the same 422. Keeping it pure (plain JSON in, plain data out) lets it be
 * imported by a client component AND unit-tested without the store.
 *
 * All dates are handled in UTC, exactly as the server computes them.
 */
import type { BookingUnit } from '@/types/booking';
import type { DaySlot } from '@/types/mentor';

/** One unavailable span from the public availability read. */
export interface AvailabilityIntervalDto {
  /** ISO datetime (inclusive start). */
  start: string;
  /** ISO datetime (exclusive end). */
  end: string;
  kind: 'BOOKING' | 'BLOCK';
  allDay: boolean;
}

/** The full `GET /api/spaces/:id/availability` response shape. */
export interface SpaceAvailabilityResponse {
  spaceId: string;
  from: string;
  to: string;
  capacity: number;
  /** 0 = Sun … 6 = Sat. */
  workingDays: number[];
  openingTime: string;
  closingTime: string;
  intervals: AvailabilityIntervalDto[];
}

/** Per-day classification for one calendar cell. */
export interface DayInfo {
  /** YYYY-MM-DD (UTC). */
  date: string;
  isWorkingDay: boolean;
  isPast: boolean;
  /** Owner-set block (full-day or time-range) touches this day. */
  hasBlock: boolean;
  /** Active booking occupancy touches this day. */
  hasBooking: boolean;
  /** Whole day is owner-blocked. */
  fullyBlocked: boolean;
  /** True iff a booking of `unit` could start on this day (UI gate; server is authoritative). */
  selectableForUnit: boolean;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60_000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Today as YYYY-MM-DD in UTC (matches the server's day arithmetic). */
export function todayUtcISO(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

/** "HH:MM" → minutes since midnight (NaN-safe). */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** UTC-midnight ms for a YYYY-MM-DD date. */
function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** YYYY-MM-DD (UTC) of a ms timestamp. */
function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const isSingleDayUnit = (unit: BookingUnit): boolean => unit === 'HOUR' || unit === 'HALF_DAY';

/**
 * Hourly blocks for one day, available iff the hour falls on a working day, is
 * not in the past, and overlaps NO unavailable interval. Mirrors the legacy
 * `buildDaySlots` semantics (an hour is free unless the server reports occupancy
 * or a block over it), but sourced from the single canonical endpoint.
 */
export function daySlotsFromIntervals(
  date: string,
  res: Pick<SpaceAvailabilityResponse, 'intervals' | 'workingDays' | 'openingTime' | 'closingTime'>,
  opts: { today?: string } = {},
): DaySlot[] {
  const today = opts.today ?? todayUtcISO();
  const open = toMinutes(res.openingTime);
  const close = toMinutes(res.closingTime);
  const base = dayStartMs(date);
  const dayEnd = base + MS_PER_DAY;
  const isWorkingDay = res.workingDays.includes(new Date(base).getUTCDay());
  const isPast = date < today;

  // Pre-clip the day's intervals to [base, dayEnd) as minute ranges.
  const dayRanges: { from: number; to: number }[] = [];
  for (const iv of res.intervals) {
    const s = Date.parse(iv.start);
    const e = Date.parse(iv.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (s >= dayEnd || e <= base) continue;
    dayRanges.push({
      from: Math.max(0, (s - base) / MS_PER_MIN),
      to: Math.min(1440, (e - base) / MS_PER_MIN),
    });
  }

  const slots: DaySlot[] = [];
  for (let m = open; m + 60 <= close; m += 60) {
    const blocked = dayRanges.some((r) => m < r.to && m + 60 > r.from);
    slots.push({
      start: `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`,
      end: `${pad2(Math.floor((m + 60) / 60))}:${pad2((m + 60) % 60)}`,
      available: isWorkingDay && !isPast && !blocked,
    });
  }
  return slots;
}

/**
 * Classify every calendar day in [from, to] of the response. `selectableForUnit`
 * encodes the UI gate per unit:
 *   • DAY / MONTH  → the WHOLE day must be free (a full-day booking can't coexist
 *                    with any booking or block that day).
 *   • HOUR / HALF_DAY → at least one bookable hour remains (day not fully
 *                    saturated), matching the legacy "not fully booked" rule.
 */
export function computeDayInfos(
  res: SpaceAvailabilityResponse,
  opts: { unit: BookingUnit; today?: string },
): DayInfo[] {
  const today = opts.today ?? todayUtcISO();
  const single = isSingleDayUnit(opts.unit);
  const firstDay = dayStartMs(res.from.slice(0, 10));
  const lastDay = dayStartMs(res.to.slice(0, 10));

  const out: DayInfo[] = [];
  for (let ms = firstDay; ms <= lastDay; ms += MS_PER_DAY) {
    const date = isoDate(ms);
    const dayEnd = ms + MS_PER_DAY;
    const isWorkingDay = res.workingDays.includes(new Date(ms).getUTCDay());
    const isPast = date < today;

    let hasBlock = false;
    let hasBooking = false;
    let fullyBlocked = false;
    let overlapsAny = false;
    for (const iv of res.intervals) {
      const s = Date.parse(iv.start);
      const e = Date.parse(iv.end);
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      if (s >= dayEnd || e <= ms) continue;
      overlapsAny = true;
      if (iv.kind === 'BLOCK') {
        hasBlock = true;
        if (iv.allDay) fullyBlocked = true;
      } else {
        hasBooking = true;
      }
    }

    let selectableForUnit: boolean;
    if (isPast || !isWorkingDay) {
      selectableForUnit = false;
    } else if (single) {
      // At least one free hour remains.
      selectableForUnit = daySlotsFromIntervals(date, res, { today }).some((s) => s.available);
    } else {
      // A full-day booking needs the whole day clear.
      selectableForUnit = !overlapsAny;
    }

    out.push({ date, isWorkingDay, isPast, hasBlock, hasBooking, fullyBlocked, selectableForUnit });
  }
  return out;
}

/** Calendar bucket arrays the shared `AvailabilityCalendar` consumes. */
export interface CalendarBuckets {
  availableDates: string[];
  bookedDates: string[];
  blockedDates: string[];
}

/**
 * PUBLIC (booking picker) view: a day is `available` iff selectable for the unit;
 * otherwise it surfaces WHY it can't be picked — `blocked` (owner) wins over
 * `booked`. A day that is still selectable is never labelled booked/blocked, so
 * the picker never disables a day the server would accept.
 */
export function publicBuckets(infos: DayInfo[]): CalendarBuckets {
  const availableDates: string[] = [];
  const bookedDates: string[] = [];
  const blockedDates: string[] = [];
  for (const d of infos) {
    if (d.selectableForUnit) availableDates.push(d.date);
    else if (d.hasBlock) blockedDates.push(d.date);
    else if (d.hasBooking) bookedDates.push(d.date);
  }
  return { availableDates, bookedDates, blockedDates };
}

/**
 * OWNER (block editor) view: every day is clickable to (un)block, so selectability
 * is irrelevant — surface the raw signals so the owner sees what is currently
 * blocked (and can unblock) vs. what is taken by a booking. Block wins over booking.
 */
export function ownerBuckets(infos: DayInfo[]): Pick<CalendarBuckets, 'bookedDates' | 'blockedDates'> {
  const bookedDates: string[] = [];
  const blockedDates: string[] = [];
  for (const d of infos) {
    if (d.hasBlock) blockedDates.push(d.date);
    else if (d.hasBooking) bookedDates.push(d.date);
  }
  return { bookedDates, blockedDates };
}

/** First/last YYYY-MM-DD of a "YYYY-MM" month — the from/to to fetch for a grid. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad2(last)}` };
}
