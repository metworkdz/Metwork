/**
 * Canonical space-availability module for the category-specific booking models
 * (COWORKING desks + DOMICILIATION address slots).
 *
 * THE single source of truth — every route (public booking AND incubator manual
 * booking) MUST call these functions; the desk/slot rules are never inlined
 * elsewhere, so public and operator surfaces can never diverge.
 *
 * NOTE: time-windowed calendar occupancy for PRIVATE_OFFICE (and legacy hourly
 * coworking) still lives in `src/server/bookings/availability.ts`
 * (`checkSpaceAvailability`). This module owns ONLY the per-day desk model and
 * the domiciliation slot count — the two behaviors that the BookingRecord-based
 * gate does not cover.
 *
 * All functions read a fresh store snapshot via `db.read` — they are NOT atomic
 * with a caller's `db.update`. Write paths that need a race-free check must
 * re-validate against the data already held inside their own update closure.
 */
import { db } from '@/server/db/store';
import type { DeskBookingRecord, SpaceRecord } from '@/server/db/store';

/* ─────────────────── Canonical desk day-range overlap ───────────────────
 * Every desk reservation — DAY, MONTH, or RANGE — collapses to an inclusive
 * [start, end] day span ("YYYY-MM-DD"). Conflicts are then a single plain
 * range-overlap test, so the three granularities can never diverge. Dates are
 * compared lexicographically, which is chronological for zero-padded ISO days.
 */

/** Inclusive last day "YYYY-MM-DD" of a "YYYY-MM" month. */
function lastDayOfMonth(month: string): string {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based ⇒ day 0 of next = last of this
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Collapse any desk booking to its inclusive [start, end] day span. */
function bookingDayRange(b: DeskBookingRecord): { start: string; end: string } {
  if (b.unit === 'MONTH') {
    const month = b.date.slice(0, 7);
    return { start: `${month}-01`, end: lastDayOfMonth(month) };
  }
  if (b.unit === 'RANGE') {
    // Tolerate a missing/empty endDate by falling back to a single-day hold.
    const end = b.endDate && b.endDate >= b.date ? b.endDate : b.date;
    return { start: b.date, end };
  }
  return { start: b.date, end: b.date }; // DAY (and legacy undefined)
}

/** Inclusive day-range overlap (all bounds "YYYY-MM-DD"). */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Active (non-cancelled) desk booking for this space whose span hits [qStart, qEnd]? */
function conflicts(
  b: DeskBookingRecord,
  spaceId: string,
  qStart: string,
  qEnd: string,
): boolean {
  if (b.spaceId !== spaceId || b.status === 'CANCELLED') return false;
  const { start, end } = bookingDayRange(b);
  return rangesOverlap(start, end, qStart, qEnd);
}

/** Look up a space record by id (null when missing). */
function findSpace(spaces: SpaceRecord[] | undefined, spaceId: string): SpaceRecord | null {
  return (spaces ?? []).find((s) => s.id === spaceId) ?? null;
}

/**
 * Core: desks free across the whole inclusive span [qStart, qEnd] =
 * declared `deskNames` minus desks held by any active booking overlapping it.
 * Returns [] for unknown spaces, spaces with no declared desks, or an inverted
 * range (qEnd < qStart).
 */
async function availableDesksInRange(
  spaceId: string,
  qStart: string,
  qEnd: string,
): Promise<string[]> {
  if (qEnd < qStart) return [];
  const data = await db.read();
  const space = findSpace(data.spaces, spaceId);
  if (!space) return [];

  const declared = space.deskNames ?? [];
  if (declared.length === 0) return [];

  const taken = new Set(
    (data.deskBookings ?? [])
      .filter((b) => conflicts(b, spaceId, qStart, qEnd))
      .map((b) => b.deskName),
  );

  return declared.filter((name) => !taken.has(name));
}

/**
 * Pure, snapshot-based twin of `deskFreeInRange` — takes the deskBookings array
 * directly so write paths can re-check INSIDE their own `db.update` critical
 * section (race-free) without duplicating the overlap logic. Returns false for
 * an inverted range.
 */
export function isDeskFreeInRange(
  deskBookings: DeskBookingRecord[],
  spaceId: string,
  deskName: string,
  qStart: string,
  qEnd: string,
): boolean {
  if (qEnd < qStart) return false;
  return !deskBookings.some(
    (b) => b.deskName === deskName && conflicts(b, spaceId, qStart, qEnd),
  );
}

/**
 * Pure: all active (non-cancelled) bookings for `spaceId` that cover the single
 * day `date` ("YYYY-MM-DD"), of any granularity. Lets the desk-calendar build
 * its grid using the SAME overlap rule as the booking gate (no duplication).
 */
export function listDeskBookingsForDay(
  deskBookings: DeskBookingRecord[],
  spaceId: string,
  date: string,
): DeskBookingRecord[] {
  return deskBookings.filter((b) => conflicts(b, spaceId, date, date));
}

/** Core: is `deskName` free across the whole inclusive span [qStart, qEnd]? */
async function deskFreeInRange(
  spaceId: string,
  deskName: string,
  qStart: string,
  qEnd: string,
): Promise<boolean> {
  const data = await db.read();
  return isDeskFreeInRange(data.deskBookings ?? [], spaceId, deskName, qStart, qEnd);
}

/* ─────────────────────────── Public API ─────────────────────────────────
 * Day / month / range variants are thin wrappers over the two core helpers, so
 * there is exactly one overlap implementation behind all of them.
 */

/**
 * Desks bookable on `date` ("YYYY-MM-DD") — declared `deskNames` minus desks
 * held by any active booking (DAY/MONTH/RANGE) covering that day.
 */
export function getAvailableDesks(spaceId: string, date: string): Promise<string[]> {
  return availableDesksInRange(spaceId, date, date);
}

/**
 * True when `deskName` is free on the whole day `date` ("YYYY-MM-DD"). Does NOT
 * require the desk to exist in `deskNames`; callers needing that guarantee
 * validate against the space record separately.
 */
export function isDeskAvailable(spaceId: string, deskName: string, date: string): Promise<boolean> {
  return deskFreeInRange(spaceId, deskName, date, date);
}

/** Desks bookable for the whole month `month` ("YYYY-MM"). */
export function getAvailableDesksForMonth(spaceId: string, month: string): Promise<string[]> {
  return availableDesksInRange(spaceId, `${month}-01`, lastDayOfMonth(month));
}

/** True when `deskName` is free for the entire month `month` ("YYYY-MM"). */
export function isDeskAvailableForMonth(
  spaceId: string,
  deskName: string,
  month: string,
): Promise<boolean> {
  return deskFreeInRange(spaceId, deskName, `${month}-01`, lastDayOfMonth(month));
}

/**
 * Desks bookable across the inclusive range [startDate, endDate]
 * ("YYYY-MM-DD" each) — for spans longer than a single month. Returns [] when
 * the range is inverted.
 */
export function getAvailableDesksForRange(
  spaceId: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  return availableDesksInRange(spaceId, startDate, endDate);
}

/** True when `deskName` is free across the inclusive range [startDate, endDate]. */
export function isDeskAvailableForRange(
  spaceId: string,
  deskName: string,
  startDate: string,
  endDate: string,
): Promise<boolean> {
  return deskFreeInRange(spaceId, deskName, startDate, endDate);
}

/**
 * Domiciliation address-slot capacity for a space. `used` counts requests with
 * status === 'ACTIVE'; `total` comes from the space's `domiciliationSlots`
 * (0 when unset). `available` is clamped at 0 so an over-subscribed listing
 * never reports a negative count.
 */
export async function getDomiciliationAvailability(
  spaceId: string,
): Promise<{ total: number; used: number; available: number }> {
  const data = await db.read();
  const space = findSpace(data.spaces, spaceId);
  const total = space?.domiciliationSlots ?? 0;

  const used = (data.domiciliationRequests ?? []).filter(
    (r) => r.spaceId === spaceId && r.status === 'ACTIVE',
  ).length;

  return { total, used, available: Math.max(0, total - used) };
}
