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

/** True only when the stored timestamp reflects a time somebody actually chose. */
export function listingHasClockTime(kind: string | null | undefined): boolean {
  return kind === 'SPACE';
}

export interface FormatWhenOptions {
  /** BCP-47 tag, e.g. 'fr-DZ'. */
  intlLocale: string;
  /** Listing kind — decides whether a clock time is shown at all. */
  kind: string | null | undefined;
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
      ...(listingHasClockTime(kind) ? { timeStyle: 'short' as const } : {}),
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}
