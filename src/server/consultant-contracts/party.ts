/**
 * The Metwork side of a consultant contract.
 *
 * A contract has two parties. The consultant is a `MentorRecord`; Metwork's own
 * legal identity — when the admin chooses to reference it — lives on the
 * admin-managed `IncubatorRecord`, the same record the receipt and invoice
 * letterheads already read (`getOrCreateAdminIncubator` provisions it).
 *
 * There is deliberately NO completeness gate here. The contract document is
 * the admin's own template, verbatim — they may write "EURL METWORK, RC
 * 31/00-…" directly as prose, use the optional `{{metwork_rc}}` / `{{metwork_nif}}`
 * / `{{metwork_address}}` tokens (see `variables.ts`), or reference Metwork's
 * identity some other way entirely. Blocking every contract on three specific
 * admin-record fields — as an earlier version of this module did — forced a
 * second place to enter information the admin had often already typed once,
 * and was the actual cause of "why do I need this, I already wrote it in the
 * contract." A token an admin doesn't fill in simply renders blank, same as
 * any other unresolved token.
 */
import type { DbLike, IncubatorRecord, UserRecord } from './types';

/**
 * The incubator record that represents Metwork itself.
 *
 * Resolved by ADMIN ownership rather than by the id of whoever created a
 * contract, so every admin's `{{metwork_*}}` tokens resolve to the same
 * legal identity regardless of who is signed in.
 */
export function findMetworkParty(d: DbLike): IncubatorRecord | null {
  const adminIds = new Set(
    (d.users ?? []).filter((u: UserRecord) => u.role === 'ADMIN').map((u: UserRecord) => u.id),
  );
  // `managerId` is nullable on legacy incubator records; an unowned one can
  // never be the admin's.
  return (d.incubators ?? []).find((i) => i.managerId != null && adminIds.has(i.managerId)) ?? null;
}
