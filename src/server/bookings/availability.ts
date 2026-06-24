/**
 * Shared space-availability validator.
 *
 * THE single source of truth for "can this space be booked for this window?",
 * called from EVERY booking-creation path so the rules can never diverge:
 *   - the wallet / cash-reserve / network-pass flow (createSpaceBooking)
 *   - the card flow (createCardBookingIntent + applyCardSettlement re-check)
 *   - both incubator manual-booking routes
 *
 * It owns three concerns and nothing else:
 *
 *  1. BLACKOUTS — a date (or a time range within a date) blocked by the
 *     incubator is bookable by NO ONE, including the incubator's own manual
 *     bookings, until it is unblocked. Surfaced as reason 'DATE_UNAVAILABLE'.
 *
 *  2. CAPACITY-AWARE OCCUPANCY — each active booking occupies ONE unit of the
 *     space's capacity. A full-day booking (unit DAY/MONTH) occupies its unit
 *     for the WHOLE calendar day(s) it covers; an hourly booking occupies it
 *     only for its time window. A request is allowed iff, at every instant it
 *     would occupy, occupancy stays below capacity.
 *       - capacity 1 (rooms, offices): any overlap → 'OVERLAP_CONFLICT'
 *         (identical to the legacy one-booking-per-window behaviour, and to the
 *         "one mode per day" rule — any hourly booking blocks a full day, and a
 *         full-day booking blocks everything else that day).
 *       - capacity > 1 (coworking with N desks): concurrent bookings are
 *         allowed up to N; the (N+1)-th overlapping booking → 'CAPACITY_EXCEEDED'.
 *
 * PENDING_PAYMENT / CANCELLED / REFUNDED bookings hold no seat and are ignored,
 * via the shared `bookingHoldsSeat` predicate.
 *
 * Pure & synchronous — it takes a bookings snapshot and never reads/writes the
 * store, so callers invoke it inside their own db.update critical section.
 */
import type { BookingRecord, BookingUnit, SpaceRecord } from '@/server/db/store';
import { bookingHoldsSeat } from './status';

/** Minimal space shape the check needs. */
export type AvailabilitySpace = Pick<
  SpaceRecord,
  'capacity' | 'unavailableDates' | 'blackouts'
>;

export type AvailabilityResult =
  | { ok: true }
  | { ok: false; reason: 'DATE_UNAVAILABLE'; blockedDates: string[] }
  | { ok: false; reason: 'OVERLAP_CONFLICT'; conflictingBookingId: string }
  | { ok: false; reason: 'CAPACITY_EXCEEDED'; capacity: number; taken: number };

const MS_PER_DAY = 86_400_000;

/** UTC midnight (ms) of the date containing `ms`. */
function startOfUtcDate(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** YYYY-MM-DD (UTC) for a ms timestamp at day start. */
function isoDate(dayStartMs: number): string {
  return new Date(dayStartMs).toISOString().slice(0, 10);
}

/** "HH:MM" → minutes since midnight (NaN-safe). */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** One day's slice of a booking's footprint: minutes [start, end) on `date`. */
interface DayInterval {
  date: string;
  start: number; // minutes from midnight
  end: number;
}

/**
 * Decompose a [startsAt, endsAt) window into per-calendar-day minute intervals.
 * DAY / MONTH bookings occupy the WHOLE day they touch (a reserved desk holds
 * the slot all day); HOUR / HALF_DAY bookings occupy only their actual minutes
 * (so a capacity-1 room can sell its half-day window AND the remaining hours).
 */
export function occupiedIntervals(unit: BookingUnit, startsAt: string, endsAt: string): DayInterval[] {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const out: DayInterval[] = [];
  for (let dayStart = startOfUtcDate(startMs); dayStart < endMs; dayStart += MS_PER_DAY) {
    const dayEnd = dayStart + MS_PER_DAY;
    const s = Math.max(startMs, dayStart);
    const e = Math.min(endMs, dayEnd);
    if (e <= s) continue;
    if (unit === 'HOUR' || unit === 'HALF_DAY') {
      out.push({ date: isoDate(dayStart), start: (s - dayStart) / 60_000, end: (e - dayStart) / 60_000 });
    } else {
      // Whole-day footprint for DAY / MONTH (and any multi-day spans).
      out.push({ date: isoDate(dayStart), start: 0, end: 1440 });
    }
  }
  return out;
}

/** Full-day blocked dates = legacy unavailableDates ∪ whole-day blackouts. */
function fullDayBlocked(space: AvailabilitySpace): Set<string> {
  const set = new Set(space.unavailableDates ?? []);
  for (const b of space.blackouts ?? []) {
    if (!b.from || !b.to) set.add(b.date);
  }
  return set;
}

/** Partial (time-range) blackouts grouped by date. */
function partialBlackouts(space: AvailabilitySpace): Map<string, { from: number; to: number }[]> {
  const map = new Map<string, { from: number; to: number }[]>();
  for (const b of space.blackouts ?? []) {
    if (!b.from || !b.to) continue;
    const arr = map.get(b.date) ?? [];
    arr.push({ from: timeToMinutes(b.from), to: timeToMinutes(b.to) });
    map.set(b.date, arr);
  }
  return map;
}

/** Active SPACE bookings that hold a seat (PENDING_PAYMENT/CANCELLED/REFUNDED don't). */
function seatHolding(b: BookingRecord, spaceId: string, ignoreBookingId?: string): boolean {
  return (
    b.itemKind === 'SPACE' &&
    b.itemId === spaceId &&
    b.id !== ignoreBookingId &&
    bookingHoldsSeat(b)
  );
}

/**
 * Validate a space booking window against blackouts and capacity-aware
 * occupancy. Does NOT validate working hours — callers keep
 * `validateWorkingHours` for that (its error messages differ).
 */
export function checkSpaceAvailability(args: {
  space: AvailabilitySpace;
  bookings: BookingRecord[];
  spaceId: string;
  unit: BookingUnit;
  startsAt: string;
  endsAt: string;
  /** Exclude this booking id from occupancy (settlement re-checks the booking itself). */
  ignoreBookingId?: string;
}): AvailabilityResult {
  const { space, bookings, spaceId, unit, startsAt, endsAt, ignoreBookingId } = args;
  const reqIntervals = occupiedIntervals(unit, startsAt, endsAt);
  if (reqIntervals.length === 0) return { ok: true };

  // ── 1. Blackouts ────────────────────────────────────────────────────────
  const blockedDays = fullDayBlocked(space);
  const partials = partialBlackouts(space);
  const hitBlackouts = new Set<string>();
  for (const r of reqIntervals) {
    if (blockedDays.has(r.date)) {
      hitBlackouts.add(r.date);
      continue;
    }
    for (const p of partials.get(r.date) ?? []) {
      if (r.start < p.to && r.end > p.from) {
        hitBlackouts.add(r.date);
        break;
      }
    }
  }
  if (hitBlackouts.size > 0) {
    return { ok: false, reason: 'DATE_UNAVAILABLE', blockedDates: [...hitBlackouts].sort() };
  }

  // ── 2. Capacity-aware occupancy ──────────────────────────────────────────
  const capacity = Math.max(1, space.capacity ?? 1);
  const active = bookings.filter((b) => seatHolding(b, spaceId, ignoreBookingId));

  // Pre-decompose every active booking into per-day intervals once.
  const activeByDate = new Map<string, { interval: DayInterval; bookingId: string }[]>();
  for (const b of active) {
    for (const interval of occupiedIntervals(b.unit, b.startsAt, b.endsAt)) {
      const arr = activeByDate.get(interval.date) ?? [];
      arr.push({ interval, bookingId: b.id });
      activeByDate.set(interval.date, arr);
    }
  }

  for (const r of reqIntervals) {
    const sameDay = activeByDate.get(r.date) ?? [];
    // Existing intervals overlapping the requested window on this day.
    const overlapping = sameDay.filter(
      ({ interval }) => interval.start < r.end && interval.end > r.start,
    );
    if (overlapping.length === 0) continue;

    // Peak concurrency strictly inside [r.start, r.end) via a sweep line.
    const events: { at: number; delta: number }[] = [];
    for (const { interval } of overlapping) {
      events.push({ at: Math.max(interval.start, r.start), delta: 1 });
      events.push({ at: Math.min(interval.end, r.end), delta: -1 });
    }
    // Process exits before entries at the same instant (adjacent ≠ overlapping).
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let running = 0;
    let peak = 0;
    for (const ev of events) {
      running += ev.delta;
      if (running > peak) peak = running;
    }

    if (peak >= capacity) {
      if (capacity === 1) {
        return { ok: false, reason: 'OVERLAP_CONFLICT', conflictingBookingId: overlapping[0]!.bookingId };
      }
      return { ok: false, reason: 'CAPACITY_EXCEEDED', capacity, taken: peak };
    }
  }

  return { ok: true };
}

/**
 * Best matching duration-discount percent (0–100) for a booking, applied
 * SERVER-SIDE. Booking units map to rule units: HOUR → 'HOUR', DAY/MONTH →
 * 'DAY'. Invalid rules (percent ≤0 / ≥100, minQty ≤0) are ignored defensively;
 * the highest qualifying percent wins. Returns 0 when no rule applies.
 */
export function bestDurationDiscountPercent(
  rules: { unit: 'HOUR' | 'DAY'; minQty: number; percent: number }[] | null | undefined,
  unit: BookingUnit,
  quantity: number,
): number {
  if (!rules?.length) return 0;
  // HOUR/HALF_DAY → hour rules; DAY/MONTH → day rules. A flat half-day (qty 1)
  // effectively never qualifies for an "N+ hours" rule, which is intended.
  const ruleUnit: 'HOUR' | 'DAY' = unit === 'HOUR' || unit === 'HALF_DAY' ? 'HOUR' : 'DAY';
  let best = 0;
  for (const r of rules) {
    if (r.unit !== ruleUnit) continue;
    if (!Number.isFinite(r.minQty) || !Number.isFinite(r.percent)) continue;
    if (r.minQty <= 0 || r.percent <= 0 || r.percent >= 100) continue;
    if (quantity >= r.minQty && r.percent > best) best = r.percent;
  }
  return best;
}

/** Apply a percent discount to an integer DZD amount (rounded). */
export function applyDiscountPercent(amount: number, percent: number): number {
  if (percent <= 0) return amount;
  return Math.round(amount * (1 - percent / 100));
}

/* ─────────────── Canonical unavailable-interval aggregation ─────────────── */

/** One unavailable span for a space, returned by the public availability read. */
export interface UnavailableInterval {
  /** ISO datetime (inclusive start). */
  start: string;
  /** ISO datetime (exclusive end). */
  end: string;
  /** BLOCK = owner-set blackout; BOOKING = capacity reached by active bookings. */
  kind: 'BOOKING' | 'BLOCK';
  /** True when the span covers a whole calendar day [00:00, next-00:00). */
  allDay: boolean;
}

/** Hard ceiling so an over-wide ?from&to range can't fan out unbounded work. */
export const MAX_AVAILABILITY_RANGE_DAYS = 366;

/** Parse an ISO datetime or a bare YYYY-MM-DD (as UTC midnight). */
function toMsLoose(v: string): number {
  return Date.parse(v.length === 10 ? `${v}T00:00:00.000Z` : v);
}

/**
 * Merge a day's occupied minute-intervals into the sub-ranges where concurrent
 * occupancy reaches `capacity` (i.e. a new booking would be refused). All events
 * at the same instant are applied before the threshold is re-tested, so a booking
 * ending exactly when another begins neither leaves a false gap nor merges across
 * a real one — matching the sweep in checkSpaceAvailability.
 */
function saturatedSubIntervals(
  intervals: { start: number; end: number }[],
  capacity: number,
): { start: number; end: number }[] {
  const events: { at: number; delta: number }[] = [];
  for (const iv of intervals) {
    if (iv.end <= iv.start) continue;
    events.push({ at: iv.start, delta: 1 });
    events.push({ at: iv.end, delta: -1 });
  }
  if (events.length === 0) return [];
  events.sort((a, b) => a.at - b.at);

  const out: { start: number; end: number }[] = [];
  let running = 0;
  let openStart: number | null = null;
  let i = 0;
  while (i < events.length) {
    const at = events[i]!.at;
    while (i < events.length && events[i]!.at === at) {
      running += events[i]!.delta;
      i++;
    }
    if (running >= capacity && openStart === null) {
      openStart = at;
    } else if (running < capacity && openStart !== null) {
      out.push({ start: openStart, end: at });
      openStart = null;
    }
  }
  return out;
}

/**
 * THE canonical "what is unavailable for this space in [from, to]" computation —
 * the single source behind every availability read (the public scheduler endpoint
 * and the new from/to interval endpoint). It aggregates exactly two things, using
 * the SAME helpers the write gate (checkSpaceAvailability) uses so a read can never
 * disagree with what a booking would be allowed to do:
 *
 *   (i)  active bookings REGARDLESS OF ORIGIN (online + manual) — counted via
 *        `bookingHoldsSeat`, so CANCELLED / REFUNDED / PENDING_PAYMENT release the
 *        slot — collapsed into the sub-ranges where occupancy reaches capacity.
 *   (ii) owner-set blocks: `unavailableDates` ∪ whole-day blackouts (full-day),
 *        plus time-range blackouts (partial).
 *
 * Pure & synchronous (takes a bookings snapshot, never touches the store). The
 * range is iterated day-by-day and capped at MAX_AVAILABILITY_RANGE_DAYS.
 */
export function computeUnavailableIntervals(args: {
  space: AvailabilitySpace;
  bookings: BookingRecord[];
  spaceId: string;
  /** ISO datetime or YYYY-MM-DD. */
  from: string;
  /** ISO datetime or YYYY-MM-DD (the day it falls on is included). */
  to: string;
}): UnavailableInterval[] {
  const { space, bookings, spaceId, from, to } = args;
  const fromMs = toMsLoose(from);
  const toMs = toMsLoose(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];

  const capacity = Math.max(1, space.capacity ?? 1);
  const blockedDays = fullDayBlocked(space);
  const partials = partialBlackouts(space);

  // Pre-decompose every active seat-holding booking into per-day minute-intervals.
  const activeByDate = new Map<string, { start: number; end: number }[]>();
  for (const b of bookings) {
    if (!seatHolding(b, spaceId)) continue;
    for (const iv of occupiedIntervals(b.unit, b.startsAt, b.endsAt)) {
      const arr = activeByDate.get(iv.date) ?? [];
      arr.push({ start: iv.start, end: iv.end });
      activeByDate.set(iv.date, arr);
    }
  }

  const out: UnavailableInterval[] = [];
  const firstDay = startOfUtcDate(fromMs);
  const lastDay = startOfUtcDate(toMs);
  let dayCount = 0;
  for (let dayStart = firstDay; dayStart <= lastDay; dayStart += MS_PER_DAY) {
    if (++dayCount > MAX_AVAILABILITY_RANGE_DAYS) break;
    const date = isoDate(dayStart);

    // (ii) Owner full-day block → whole day unavailable; bookings are moot.
    if (blockedDays.has(date)) {
      out.push({
        start: new Date(dayStart).toISOString(),
        end: new Date(dayStart + MS_PER_DAY).toISOString(),
        kind: 'BLOCK',
        allDay: true,
      });
      continue;
    }

    // (ii) Owner time-range blackouts on this day.
    for (const p of partials.get(date) ?? []) {
      out.push({
        start: new Date(dayStart + p.from * 60_000).toISOString(),
        end: new Date(dayStart + p.to * 60_000).toISOString(),
        kind: 'BLOCK',
        allDay: false,
      });
    }

    // (i) Booking occupancy collapsed to capacity-saturated sub-ranges.
    for (const sat of saturatedSubIntervals(activeByDate.get(date) ?? [], capacity)) {
      out.push({
        start: new Date(dayStart + sat.start * 60_000).toISOString(),
        end: new Date(dayStart + sat.end * 60_000).toISOString(),
        kind: 'BOOKING',
        allDay: sat.start === 0 && sat.end === 1440,
      });
    }
  }

  out.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return out;
}
