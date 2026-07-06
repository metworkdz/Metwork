/**
 * Notification counts — the centralized service. One store read per call;
 * both operations (`getNotificationCounts` + `markSeen`) live here and
 * nowhere else. Read-only over existing data except the per-user
 * `notificationsSeen` map (the feature's ONLY write).
 */
import { db } from '@/server/db/store';
import {
  sourcesForRole,
  type BadgeContext,
  type StoreDoc,
} from '@/server/notifications/activity-sources';

export type NotificationCounts = Record<string, number>;

/** Build the shared per-request context for a role's sources. */
function buildContext(data: StoreDoc, user: BadgeContext['user']): BadgeContext {
  const seen = user.notificationsSeen ?? {};

  // Incubator scope — resolved once so no source re-derives it (one pass).
  let incubatorId: string | null = null;
  const ownedSpaceIds = new Set<string>();
  const ownedProgramIds = new Set<string>();
  const ownedEventIds = new Set<string>();
  if (user.role === 'INCUBATOR') {
    const inc = (data.incubators ?? []).find((i) => i.managerId === user.id);
    if (inc) {
      incubatorId = inc.id;
      for (const s of data.spaces ?? []) if (s.incubatorId === inc.id) ownedSpaceIds.add(s.id);
      for (const p of data.programs ?? []) if (p.incubatorId === inc.id) ownedProgramIds.add(p.id);
      for (const e of data.events ?? []) if (e.incubatorId === inc.id) ownedEventIds.add(e.id);
    }
  }

  return {
    data,
    user,
    seenOf: (key) => seen[key] ?? '',
    incubatorId,
    ownedSpaceIds,
    ownedProgramIds,
    ownedEventIds,
  };
}

/**
 * Compute counts for a user — every source of the user's role is present in
 * the result (0 included). A failing source contributes 0 and is logged; it
 * never fails the whole response. Roles with no sources (INVESTOR/BUSINESS)
 * get `{}`. Never throws.
 */
export async function getNotificationCounts(userId: string): Promise<NotificationCounts> {
  try {
    const data = await db.read();
    const user = (data.users ?? []).find((u) => u.id === userId);
    if (!user) return {};

    const sources = sourcesForRole(user.role);
    if (sources.length === 0) return {};

    const ctx = buildContext(data, user);
    const counts: NotificationCounts = {};
    for (const source of sources) {
      try {
        counts[source.key] = source.count(ctx);
      } catch (err) {
        // One broken source must not take down the rest — report 0, log.
        counts[source.key] = 0;
        console.error(`[notifications] count failed for source "${source.key}"`, err);
      }
    }
    return counts;
  } catch (err) {
    // Requirement: failed counts degrade gracefully — no badge, no crash.
    console.error('[notifications] getNotificationCounts failed', err);
    return {};
  }
}

/**
 * The ONLY write this feature performs: stamp "now" as the user's seen time
 * for one source key. Key-merge only — sibling keys written by another tab
 * are preserved. Returns the stamp written (null when the user is unknown
 * or the write failed — non-critical, the count just lingers).
 */
export async function markSeen(userId: string, key: string): Promise<string | null> {
  const seenAt = new Date().toISOString();
  try {
    let applied = false;
    await db.update((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (!user) return;
      user.notificationsSeen = { ...(user.notificationsSeen ?? {}), [key]: seenAt };
      applied = true;
    });
    return applied ? seenAt : null;
  } catch (err) {
    console.error(`[notifications] markSeen failed for source "${key}"`, err);
    return null;
  }
}
