/**
 * Admin-as-incubator helper.
 *
 * The admin account doubles as the platform's own incubator (Metwork).
 * Rather than requiring a separate INCUBATOR account, we lazily provision
 * a default IncubatorRecord for the admin on first use and return it on
 * subsequent calls.
 *
 * This helper is intentionally kept minimal — it only reads/creates the
 * record; all display logic lives in the consuming pages/components.
 */
import { randomUUID } from 'node:crypto';
import { db, type IncubatorRecord } from '@/server/db/store';

/**
 * Return the IncubatorRecord managed by the given admin, creating a default
 * "Metwork" incubator if one does not yet exist.
 *
 * Safe to call concurrently — the write is guarded inside db.update so only
 * one record is ever created even on a cold-start with multiple parallel requests.
 */
export async function getOrCreateAdminIncubator(adminId: string): Promise<IncubatorRecord> {
  const data = await db.read();
  const existing = data.incubators.find((i) => i.managerId === adminId);
  if (existing) return existing;

  // Not found — create the default Metwork incubator inside the write lock.
  return db.update((d) => {
    // Re-check inside the lock in case a concurrent request beat us here.
    const check = d.incubators.find((i) => i.managerId === adminId);
    if (check) return check;

    const now = new Date().toISOString();
    const record: IncubatorRecord = {
      id: randomUUID(),
      name: 'Metwork',
      description:
        "Algeria's unified startup platform — incubator, coworking space, and accelerator.",
      city: 'Oran',
      managerId: adminId,
      status: 'ACTIVE',
      website: null,
      logoUrl: null,
      // Admin's incubator uses FLAT billing; commissions don't apply to the platform itself.
      subscriptionTier: 'FLAT',
      createdAt: now,
      updatedAt: now,
    };
    d.incubators.push(record);
    return record;
  });
}
