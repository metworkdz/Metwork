/**
 * Does a booking's timestamp carry a real clock time, or only a date?
 *
 * Not every listing captures one. A SPACE is booked against an actual window —
 * the client picks 09:00–11:00. A PROGRAM and an EVENT are authored with plain
 * `type="date"` inputs and stored anchored at **noon local**, purely so the day
 * survives timezone conversion. There is no start time in the product.
 *
 * Rendering those timestamps with a clock invented one. In Algeria (UTC+1) the
 * noon anchor comes back as `11:00Z`, so a client confirming a 24 000 DZD
 * training was told it starts at 11:00 — a number nobody entered, on the last
 * screen before they pay. The receipt PDF already got this right (it prints a
 * time only for HOUR / HALF_DAY space bookings); the pay pages and the receipt
 * email did not.
 *
 * `unit` is NOT a safe discriminator: an EVENT card booking is recorded with
 * `unit: 'HOUR'` even though its date is day-only. The listing kind is.
 *
 * If programs or events ever gain a real start-time field, flip the kind here
 * and every surface follows.
 */

export type DatedListingKind = 'SPACE' | 'PROGRAM' | 'EVENT';

/** The minimum a booking must expose for the rule below to decide. */
export interface ClockTimeSource {
  itemKind?: string | null;
  /**
   * Set at booking creation when `startsAt` carries a real chosen time —
   * always for a SPACE, and for a PROGRAM whose host filled in `startTime`.
   * Absent on every booking made before programs could have one, which is why
   * the kind is still the fallback.
   */
  startsAtHasClockTime?: boolean | null;
}

/**
 * True only when the stored timestamp reflects a time somebody actually chose.
 *
 * Accepts either a bare listing kind (for surfaces that know nothing else) or
 * a booking. A booking's explicit flag wins: a program with a start time has a
 * real one, and a program without still must not show the noon anchor.
 */
export function listingHasClockTime(
  source: string | null | undefined | ClockTimeSource,
): boolean {
  if (source && typeof source === 'object') {
    if (source.startsAtHasClockTime != null) return source.startsAtHasClockTime;
    return source.itemKind === 'SPACE';
  }
  return source === 'SPACE';
}

export interface FormatWhenOptions {
  /** BCP-47 tag, e.g. 'fr-DZ'. */
  intlLocale: string;
  /** Listing kind, or the booking — decides whether a clock time is shown. */
  kind: string | null | undefined | ClockTimeSource;
  /** Date verbosity. Defaults to 'long'. */
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
}

/**
 * Render a booking timestamp for a client-facing surface: the date always, the
 * time ONLY when the listing kind actually has one.
 *
 * Formatted in UTC on purpose — the stored value is a UTC-anchored wall time,
 * so re-interpreting it in the viewer's zone would shift the day.
 */
export function formatBookingWhen(
  iso: string | null | undefined,
  { intlLocale, kind, dateStyle = 'long' }: FormatWhenOptions,
): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(intlLocale, {
      dateStyle,
      // h23 explicitly: CLDR resolves fr-DZ and ar-DZ to a 12-hour clock, so an
      // 18:30 session rendered as "6:30 PM" / "6:30 م" — not how Algeria writes
      // time, and not what the host typed into a 24-hour input.
      ...(listingHasClockTime(kind)
        ? { timeStyle: 'short' as const, hourCycle: 'h23' as const }
        : {}),
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

/** A local wall-clock time, "HH:MM" on a 24-hour clock. */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when `value` is a well-formed "HH:MM". */
export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value);
}

/**
 * Combine a stored date with a "HH:MM" wall-clock time into the instant a
 * booking actually starts.
 *
 * `startDate` is anchored at noon local so the DAY survives conversion; this
 * replaces the anchor's time-of-day with the real one, keeping the same day.
 * Returns the original ISO string when there is no time to apply, so a program
 * without one is untouched.
 */
export function applyClockTime(iso: string, time: string | null | undefined): string {
  if (!isClockTime(time)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const [h, m] = time.split(':').map(Number) as [number, number];
  // The anchor is a UTC instant representing a local day; set the clock in the
  // same frame the rest of the app formats in (UTC).
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}
