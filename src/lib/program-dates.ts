/**
 * A program's dates, including a program whose dates are still to confirm.
 *
 * A host can publish a program as a pre-registration before fixing its dates
 * ("dates à confirmer"). Such a program has NO dates — no placeholder that
 * could leak into an email, a receipt or a certificate — and until the host
 * sets them:
 *
 *   - registration stays open (there is no deadline to pass);
 *   - no money is taken: a paid seat is a booking, and a booking is a date —
 *     receipts, reminders and refunds all read it. Sign-ups are free
 *     pre-registrations; the price, if any, is only indicative. Once the
 *     dates are set, the program behaves as any other, and new sign-ups pay.
 *
 * Every surface decides through these helpers, so none can disagree about
 * whether a program is open or how it reads. Dependency-free: the public
 * pages, the dashboard, the portal and the server all import it.
 */

export interface ProgramDatesShape {
  datesTbc?: boolean | null;
  deadline?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** The program's dates are still to confirm. */
export function programDatesTbc(p: ProgramDatesShape): boolean {
  // Missing dates mean "to confirm" even without the flag — a record can
  // never be read as dated when it has nothing to read.
  return Boolean(p.datesTbc) || !p.startDate || !p.endDate || !p.deadline;
}

/** A dated program's dates, or null while they are to confirm. */
export function programDates(
  p: ProgramDatesShape,
): { deadline: string; startDate: string; endDate: string } | null {
  if (programDatesTbc(p)) return null;
  return { deadline: p.deadline!, startDate: p.startDate!, endDate: p.endDate! };
}

/** The application deadline has passed. Never true while dates are to confirm. */
export function programDeadlinePassed(p: ProgramDatesShape, now: number = Date.now()): boolean {
  const dates = programDates(p);
  return dates ? Date.parse(dates.deadline) <= now : false;
}

/** Sort key: dated programs by the given date, programs to confirm last. */
export function programDateSortKey(p: ProgramDatesShape, which: 'deadline' | 'startDate'): number {
  const dates = programDates(p);
  return dates ? Date.parse(dates[which]) : Number.POSITIVE_INFINITY;
}
