/**
 * "Is there a limit, and is there room?" — the ONE rule for events and programs.
 *
 * A listing normally has a number of places (`capacity` on an event, `seatsTotal`
 * on a program). A host can instead switch on "No limit on registrations"
 * (`unlimitedCapacity`): nobody is ever refused, nobody is waitlisted, and the
 * public never sees how many people have registered.
 *
 * This used to be a bare `taken >= capacity` copied into seven places that refuse
 * someone and about sixteen that draw a counter. Each one now asks this module, so
 * they cannot disagree — and so a new one cannot forget the "no limit" case.
 *
 * The numeric capacity is KEPT when the limit is switched off, so switching it
 * back on restores the host's number instead of asking for it again.
 *
 * Pure and dependency-free: server gates and client screens import the same code.
 */

/** What any listing carries that this rule reads. */
export interface SeatLimited {
  /** Events. */
  capacity?: number | null;
  /** Programs. */
  seatsTotal?: number | null;
  /** The host switched the limit off. Absent on every older record = limited. */
  unlimitedCapacity?: boolean | null;
}

/** What the create forms start from, so "no limit" can be saved without typing a number first. */
export const DEFAULT_EVENT_CAPACITY = 50;
export const DEFAULT_PROGRAM_SEATS = 20;

/** Has the host switched the limit off? */
export function isUnlimited(listing: SeatLimited): boolean {
  return listing.unlimitedCapacity === true;
}

/** The number of places, or null when there is no limit. */
export function seatLimit(listing: SeatLimited): number | null {
  if (isUnlimited(listing)) return null;
  return listing.capacity ?? listing.seatsTotal ?? 0;
}

/** Can one more person be seated, given how many already are? Always true with no limit. */
export function hasRoom(listing: SeatLimited, taken: number): boolean {
  const limit = seatLimit(listing);
  return limit === null || taken < limit;
}

/** Places left, or null when there is no limit (there is no number to show). */
export function seatsLeft(listing: SeatLimited, taken: number): number | null {
  const limit = seatLimit(listing);
  return limit === null ? null : Math.max(0, limit - taken);
}

/** Full? Never, with no limit. */
export function isFull(listing: SeatLimited, taken: number): boolean {
  return !hasRoom(listing, taken);
}

/** 0–100 fill for a progress bar, or null when there is no limit (draw no bar). */
export function fillPercent(listing: SeatLimited, taken: number): number | null {
  const limit = seatLimit(listing);
  if (limit === null) return null;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((taken / limit) * 100));
}

/**
 * The public status endpoints (`/api/{events,programs}/:id/status`) send either
 * `{ unlimited: true }` or `{ capacity, taken }` — never both, never a count for a
 * listing with no limit. These read that shape so screens do not compare numbers.
 */
export interface SeatStatus {
  unlimited?: boolean;
  capacity?: number;
  taken?: number;
}

/** Full according to a status payload. Never full with no limit or no payload. */
export function statusIsFull(status: SeatStatus | null | undefined): boolean {
  if (!status || status.unlimited) return false;
  if (status.capacity === undefined || status.taken === undefined) return false;
  return status.taken >= status.capacity;
}

/** Places left according to a status payload, or null when there is no limit / no data. */
export function statusSeatsLeft(status: SeatStatus | null | undefined): number | null {
  if (!status || status.unlimited) return null;
  if (status.capacity === undefined || status.taken === undefined) return null;
  return Math.max(0, status.capacity - status.taken);
}
