/**
 * The date a converted facture carries — ONE rule, read by the convert route
 * and by the convert dialog, so the picker can never offer a day the server
 * refuses.
 *
 * Converting a proforma used to stamp the facture with the moment of the
 * click. The host chooses it now, within two bounds:
 *   - not before the proforma's own date (a facture cannot predate the offer
 *     it confirms);
 *   - not after today in Algeria (an invoice dated in the future is not a
 *     record of anything yet).
 *
 * Days are "YYYY-MM-DD". Invoice PDFs print the UTC calendar day of
 * `issuedAt` (see pdf/viewModel.ts), so a chosen day is stored at 12:00 UTC:
 * whatever time zone reads it back, it is still that day.
 *
 * Dependency-free on purpose — it ships in the client bundle.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Algeria is UTC+1 all year (no DST), so a fixed offset is exact. */
const ALGIERS_OFFSET_MS = 60 * 60 * 1000;

/** The calendar day a stored `issuedAt` prints as. */
export function invoiceDayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Today's date in Algeria. */
export function algiersToday(now: Date = new Date()): string {
  return new Date(now.getTime() + ALGIERS_OFFSET_MS).toISOString().slice(0, 10);
}

/** A real calendar day ("2026-02-30" is not). */
export function isValidDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const d = new Date(`${day}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export type ConversionDayError = 'INVALID_DATE' | 'BEFORE_SOURCE' | 'IN_FUTURE';

/** The bounds the picker offers for a given proforma / devis. */
export function conversionDayBounds(sourceIssuedAt: string, now: Date = new Date()) {
  return { min: invoiceDayOf(sourceIssuedAt), max: algiersToday(now) };
}

export function checkConversionDay(
  day: string,
  sourceIssuedAt: string,
  now: Date = new Date(),
): ConversionDayError | null {
  if (!isValidDay(day)) return 'INVALID_DATE';
  const { min, max } = conversionDayBounds(sourceIssuedAt, now);
  if (day < min) return 'BEFORE_SOURCE';
  if (day > max) return 'IN_FUTURE';
  return null;
}

/**
 * The `issuedAt` to store for a chosen day: the real moment when it is today
 * (as before), noon UTC of that day otherwise.
 */
export function issuedAtForDay(day: string, now: Date = new Date()): string {
  return invoiceDayOf(now.toISOString()) === day ? now.toISOString() : `${day}T12:00:00.000Z`;
}
