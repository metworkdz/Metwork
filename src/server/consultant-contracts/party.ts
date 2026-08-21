/**
 * The Metwork side of a consultant contract.
 *
 * A contract has two parties. The consultant is a `MentorRecord`; Metwork's own
 * legal identity lives on the admin-managed `IncubatorRecord` — the same record
 * the receipt and invoice letterheads already read (`getOrCreateAdminIncubator`
 * provisions it). This module is the one place that resolves it and decides
 * whether it is complete enough to put on a legal document.
 *
 * The completeness gate matters more here than on a receipt. A contract whose
 * purpose is to show a tax authority who collected whose money is worth nothing
 * if the party claiming to have collected it is identified only by the name
 * "Metwork" — the commercial register number and tax identifier are what make
 * it evidence. So sending is blocked until they are filled in, rather than
 * silently rendering a PDF with blank lines where they should be.
 */
import type { DbLike, IncubatorRecord, UserRecord } from './types';

/** Legal fields a contract PDF cannot go out without. */
const REQUIRED_LEGAL_FIELDS = [
  'commercialRegNumber',
  'nif',
  'address',
] as const satisfies readonly (keyof IncubatorRecord)[];

export type MetworkLegalField = (typeof REQUIRED_LEGAL_FIELDS)[number];

/**
 * The incubator record that represents Metwork itself.
 *
 * Resolved by ADMIN ownership rather than by the id of whoever clicked send, so
 * two different admins sending two contracts always name the same legal party.
 */
export function findMetworkParty(d: DbLike): IncubatorRecord | null {
  const adminIds = new Set(
    (d.users ?? []).filter((u: UserRecord) => u.role === 'ADMIN').map((u: UserRecord) => u.id),
  );
  // `managerId` is nullable on legacy incubator records; an unowned one can
  // never be the admin's.
  return (d.incubators ?? []).find((i) => i.managerId != null && adminIds.has(i.managerId)) ?? null;
}

/**
 * Which required legal identifiers are still blank. Empty array ⇒ ready to send.
 * A whitespace-only value counts as missing.
 */
export function missingLegalFields(incubator: IncubatorRecord | null): MetworkLegalField[] {
  if (!incubator) return [...REQUIRED_LEGAL_FIELDS];
  return REQUIRED_LEGAL_FIELDS.filter((field) => {
    const value = incubator[field];
    return typeof value !== 'string' || value.trim() === '';
  });
}
