/**
 * Writing a program's dates — the one rule both populations' create and edit
 * routes apply, so "dates à confirmer" means the same everywhere.
 *
 *  - Dates to confirm: deadline, start and end are ALL cleared together.
 *  - Otherwise all three are required, and ordered: applications close no
 *    later than the start, and the program ends after it starts.
 *  - A program that already has booked seats cannot go back to "dates to
 *    confirm": those participants paid for, or hold, a dated seat.
 *
 * Pure: the routes call it inside their mutation, BEFORE writing anything,
 * because the store saves the draft whatever the mutator returns.
 */
import { bookingHoldsSeat } from '@/server/bookings/status';
import type { BookingRecord, ProgramRecord } from '@/server/db/store';

export interface ProgramDatesInput {
  datesTbc?: boolean;
  deadline?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ResolvedProgramDates {
  datesTbc: boolean;
  deadline: string | null;
  startDate: string | null;
  endDate: string | null;
}

export type ProgramDatesDecision =
  | { ok: true; value: ResolvedProgramDates }
  | { ok: false; reason: 'DATES_REQUIRED' | 'DATES_ORDER' | 'HAS_BOOKINGS' };

function iso(s: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
}

/**
 * The dates a program will have after this write.
 *
 * `existing` is null on create. On edit, a field absent from the input keeps
 * its stored value; sending any date while the program is to confirm is how
 * the host fixes its dates.
 */
export function resolveProgramDates(
  existing: Pick<ProgramRecord, 'id' | 'datesTbc' | 'deadline' | 'startDate' | 'endDate'> | null,
  input: ProgramDatesInput,
  bookings: ReadonlyArray<Pick<BookingRecord, 'itemKind' | 'itemId' | 'status' | 'deletedAt'>> = [],
): ProgramDatesDecision {
  const sendsDates = input.deadline != null || input.startDate != null || input.endDate != null;
  const wasTbc = existing ? Boolean(existing.datesTbc) || !existing.startDate : false;
  // Explicit choice first; otherwise sending dates fixes them, and saying
  // nothing keeps the program as it was.
  const tbc = input.datesTbc ?? (sendsDates ? false : wasTbc);

  if (tbc) {
    if (existing && !wasTbc) {
      const booked = bookings.some(
        (b) => b.itemKind === 'PROGRAM' && b.itemId === existing.id && !b.deletedAt && bookingHoldsSeat(b),
      );
      if (booked) return { ok: false, reason: 'HAS_BOOKINGS' };
    }
    return { ok: true, value: { datesTbc: true, deadline: null, startDate: null, endDate: null } };
  }

  const pick = (k: 'deadline' | 'startDate' | 'endDate') =>
    input[k] !== undefined ? input[k] ?? null : existing?.[k] ?? null;
  const deadline = pick('deadline');
  const startDate = pick('startDate');
  const endDate = pick('endDate');
  if (!deadline || !startDate || !endDate) return { ok: false, reason: 'DATES_REQUIRED' };
  if ([deadline, startDate, endDate].some((d) => Number.isNaN(iso(d)))) return { ok: false, reason: 'DATES_REQUIRED' };
  if (!(iso(deadline) <= iso(startDate) && iso(startDate) < iso(endDate))) return { ok: false, reason: 'DATES_ORDER' };
  return { ok: true, value: { datesTbc: false, deadline, startDate, endDate } };
}

/** French messages for the routes, matching the form's own wording. */
export const PROGRAM_DATES_ERRORS: Record<'DATES_REQUIRED' | 'DATES_ORDER' | 'HAS_BOOKINGS', [number, string]> = {
  DATES_REQUIRED: [422, 'Indiquez la date limite, la date de début et la date de fin — ou cochez « Dates à confirmer ».'],
  DATES_ORDER: [422, 'La date limite doit précéder le début, et le programme doit finir après avoir commencé.'],
  HAS_BOOKINGS: [409, 'Des participants ont déjà réservé une place datée : les dates ne peuvent plus repasser « à confirmer ».'],
};
