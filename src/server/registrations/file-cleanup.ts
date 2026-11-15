/**
 * Keeping the file store honest: a stored file exists only while something
 * still points at it.
 *
 * Files get orphaned in ordinary ways — a visitor picks a file, then replaces it
 * or never submits; a duplicate registration is refused after the upload; a host
 * deletes a question, a cancelled registration or the whole listing. Two
 * mechanisms cover that:
 *
 *   • EVENT-DRIVEN: every delete path hands its files to
 *     `removeUnreferencedRegistrationFiles`, which deletes them unless another
 *     record still points at one (two registrations can name the same file).
 *   • THE SWEEP: a daily job deletes anything old enough that nothing references,
 *     which also catches whatever the event-driven path could not know about
 *     (uploads that never reached a submit, deletes that failed mid-way).
 *
 * "Referenced" means: a registration holds it, or an UNPAID card checkout does.
 * The second matters — on a paid listing the answers (and so the file) are
 * carried on the intent until settlement writes the registration, and a
 * payment can settle days later. A checkout stops counting after its pay link
 * has expired plus a day, because it can no longer be paid.
 */
import { db } from '@/server/db/store';
import { REGISTRATION_FILE_FOLDER } from '@/lib/upload-limits';
import { listRegistrationFiles, removeRegistrationFile } from './file-storage';
import { parseRegistrationFilePublicId, registrationFileIds } from './files';

type StoreData = Awaited<ReturnType<typeof db.read>>;

/** A card pay link lives 7 days (card-payment.ts); keep the file a day beyond it. */
const PENDING_CHECKOUT_KEEP_MS = 8 * 24 * 60 * 60 * 1000;

/** Files must be at least this old before the sweep may delete them. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const isOurs = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(`${REGISTRATION_FILE_FOLDER}/`);

/** Every file id a live record still points at. */
export function referencedRegistrationFileIds(data: StoreData, now = Date.now()): Set<string> {
  const ids = new Set<string>();

  for (const r of data.registrations ?? []) {
    for (const a of r.answers ?? []) if (isOurs(a.value)) ids.add(a.value);
  }
  for (const b of data.bookings ?? []) {
    if (b.status !== 'PENDING_PAYMENT' || !b.registrationDraft) continue;
    if (now - new Date(b.createdAt).getTime() > PENDING_CHECKOUT_KEEP_MS) continue;
    for (const a of b.registrationDraft.answers ?? []) if (isOurs(a.value)) ids.add(a.value);
  }
  return ids;
}

/**
 * Delete these files unless something still points at one. Reads the store AFTER
 * the caller's change has committed, so a file only its deleted owner used is
 * really removed, and one a surviving record shares is kept. Never throws.
 */
export async function removeUnreferencedRegistrationFiles(publicIds: string[]): Promise<number> {
  const candidates = [...new Set(publicIds)].filter((id) => parseRegistrationFilePublicId(id));
  if (candidates.length === 0) return 0;
  try {
    const keep = referencedRegistrationFileIds(await db.read());
    const doomed = candidates.filter((id) => !keep.has(id));
    await Promise.all(doomed.map((id) => removeRegistrationFile(id)));
    return doomed.length;
  } catch (err) {
    console.error('[registration-files] Cleanup after delete failed:', err);
    return 0;
  }
}

/** The file ids held by a set of answers — what a delete path collects before it removes them. */
export { registrationFileIds };

export interface SweepResult {
  scanned: number;
  referenced: number;
  tooYoung: number;
  foreign: number;
  deleted: number;
}

/**
 * Delete stored files nothing references and that are old enough to be safely
 * abandoned. Idempotent; bounded by `limit` per run.
 */
export async function sweepRegistrationFiles(
  options: { now?: number; minAgeMs?: number; limit?: number } = {},
): Promise<SweepResult> {
  const now = options.now ?? Date.now();
  const minAge = options.minAgeMs ?? SWEEP_MIN_AGE_MS;

  const stored = await listRegistrationFiles(options.limit ?? 2000);
  // Read AFTER listing, so a submit that lands during the listing is seen.
  const keep = referencedRegistrationFileIds(await db.read(), now);

  const result: SweepResult = { scanned: stored.length, referenced: 0, tooYoung: 0, foreign: 0, deleted: 0 };
  for (const f of stored) {
    // Never touch anything this feature did not create.
    if (!parseRegistrationFilePublicId(f.publicId)) { result.foreign += 1; continue; }
    if (keep.has(f.publicId)) { result.referenced += 1; continue; }
    if (now - f.createdAt.getTime() < minAge) { result.tooYoung += 1; continue; }
    await removeRegistrationFile(f.publicId);
    result.deleted += 1;
  }
  return result;
}
