/**
 * Single source of truth for "is this incubator (and therefore its listings)
 * visible to the public / network?".
 *
 * An incubator's spaces, programs and events appear on public pages and the
 * network ONLY when the incubator is APPROVED (status ACTIVE) and NOT archived.
 *  - PENDING / REJECTED / INACTIVE / SUSPENDED ⇒ hidden (awaiting approval, etc.)
 *  - archivedAt set                            ⇒ hidden (soft-deleted)
 *
 * Centralised so the space/program/event catalogs, the public incubators page,
 * and the network booking gate never diverge.
 */
import type { IncubatorRecord } from '@/server/db/store';

export function isPubliclyVisibleIncubator(
  inc: Pick<IncubatorRecord, 'status' | 'archivedAt'> | null | undefined,
): boolean {
  if (!inc) return false;
  if (inc.archivedAt) return false;
  return inc.status === 'ACTIVE';
}

/** Build a Set of publicly-visible incubator ids from a list of incubators. */
export function visibleIncubatorIds(
  incubators: ReadonlyArray<Pick<IncubatorRecord, 'id' | 'status' | 'archivedAt'>>,
): Set<string> {
  return new Set(
    incubators.filter((i) => isPubliclyVisibleIncubator(i)).map((i) => i.id),
  );
}

/**
 * Whether the given user manages an archived incubator. Used to block login and
 * invalidate existing sessions for owners of soft-deleted incubators.
 */
export function isArchivedIncubatorManager(
  incubators: ReadonlyArray<Pick<IncubatorRecord, 'managerId' | 'archivedAt'>>,
  userId: string,
): boolean {
  return incubators.some((i) => i.managerId === userId && !!i.archivedAt);
}
