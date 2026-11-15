/**
 * Small, dependency-free rules for the choices of a registration question and
 * for how a multi-select answer is written back out. Shared by the form builder
 * (client), the save routes (server), the registrations table and the CSV export,
 * so they cannot disagree.
 */

/** The longest a question label or a single choice may be (the save routes enforce it). */
export const MAX_OPTION_LENGTH = 200;

/** A form may have at most this many questions (the save routes enforce it). */
export const MAX_FORM_FIELDS = 30;

const norm = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase();

/**
 * What a list of choices becomes once it is cleaned: trimmed, blanks dropped.
 * Order is kept; duplicates are NOT removed here — they are an error the host is
 * told about (`findDuplicateOption`), not something to silently merge.
 */
export function cleanOptions(options: readonly string[]): string[] {
  return options.map((o) => o.trim()).filter((o) => o !== '');
}

/** The first choice that appears twice (ignoring case and surrounding spaces), if any. */
export function findDuplicateOption(options: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const o of cleanOptions(options)) {
    const key = norm(o);
    if (seen.has(key)) return o;
    seen.add(key);
  }
  return null;
}

/**
 * Paste a list into a choice box. A single-line input flattens line breaks into
 * spaces, so pasting "Alpha⏎Beta⏎Gamma" used to make ONE choice, "Alpha Beta
 * Gamma" — which made the 58 wilayas (or ten challenge areas) impossible to
 * enter without typing each. Each non-blank line becomes its own choice.
 *
 * The pasted lines REPLACE the box they were pasted into if it was empty, and are
 * inserted after it otherwise. A line already in the list is skipped. Returns the
 * new list and the index to focus afterwards.
 */
export function insertPastedOptions(
  options: readonly string[],
  at: number,
  pasted: string,
): { options: string[]; focus: number } {
  const lines = pasted.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '');
  const have = new Set(options.filter((o) => o.trim()).map(norm));
  const fresh: string[] = [];
  for (const line of lines) {
    const key = norm(line);
    if (have.has(key)) continue;
    have.add(key);
    fresh.push(line);
  }
  if (fresh.length === 0) return { options: [...options], focus: at };

  const replaceCurrent = (options[at] ?? '').trim() === '';
  const before = options.slice(0, replaceCurrent ? at : at + 1);
  const after = options.slice(at + 1);
  return { options: [...before, ...fresh, ...after], focus: before.length + fresh.length - 1 };
}

/**
 * How a multi-select answer reads in a table cell or a CSV column. A comma
 * cannot be the separator: the choices themselves contain them ("Quality, HSE &
 * Compliance"), so "A, B, C, D" could be two choices or four.
 */
export const MULTI_ANSWER_SEPARATOR = '; ';

export function formatAnswerValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(MULTI_ANSWER_SEPARATOR) : String(value);
}

/**
 * Which rows of an answer summary to draw. A question with a long list of
 * choices (the 58 wilayas) would otherwise be a wall of "0 %" bars that pushes
 * the participants table off the screen: past `limit` choices, only those that
 * were actually picked are shown, and the rest are counted.
 */
export function visibleSummaryRows<T extends { count: number }>(
  rows: readonly T[],
  options: { limit?: number; showAll?: boolean } = {},
): { rows: T[]; hidden: number } {
  const limit = options.limit ?? 8;
  if (options.showAll || rows.length <= limit) return { rows: [...rows], hidden: 0 };
  const picked = rows.filter((r) => r.count > 0);
  return { rows: picked, hidden: rows.length - picked.length };
}
