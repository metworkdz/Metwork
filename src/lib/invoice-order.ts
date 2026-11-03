/**
 * The order an issuer reads their documents in: by the date printed on them,
 * oldest first, newest last — the way an accountant reads a register.
 *
 * Dependency-free: it ships in the client bundle.
 *
 * `issuedAt` is not compared as a raw timestamp. A document dated in the past
 * is stored at 12:00 UTC while one issued today carries the real moment, so on
 * one calendar day the raw clock would order them by an accident of how they
 * were created. The printed DAY decides; within a day the document number
 * (series order), then creation order, break ties — so equal dates always come
 * out the same way.
 */
interface Orderable {
  issuedAt: string;
  year?: number;
  seq?: number;
  createdAt: string;
}

export function compareByInvoiceDate(a: Orderable, b: Orderable): number {
  // `?? ''`: one malformed legacy row must not take the whole list down.
  const dayA = (a.issuedAt ?? '').slice(0, 10);
  const dayB = (b.issuedAt ?? '').slice(0, 10);
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;
  if (a.year !== b.year) return (a.year ?? 0) - (b.year ?? 0);
  if (a.seq !== b.seq) return (a.seq ?? 0) - (b.seq ?? 0);
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
}

/** A sorted copy — the input is left as it was. */
export function sortByInvoiceDate<T extends Orderable>(rows: readonly T[]): T[] {
  return [...rows].sort(compareByInvoiceDate);
}
