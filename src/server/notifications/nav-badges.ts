/**
 * Nav activity badges — single read-only entry point.
 *
 * `getNavBadges(userId)` runs every registered source for the user's role
 * against ONE store read and returns `{ [navKey]: count }` (zero-count keys
 * omitted). NON-BLOCKING BY CONTRACT: any failure returns `{}` so a broken
 * count can never crash or block a dashboard render.
 */
import { db } from '@/server/db/store';
import {
  activitySourcesByRole,
  type BadgeContext,
  type StoreDoc,
} from '@/server/notifications/activity-sources';

export type NavBadgeMap = Record<string, number>;

/** Build the shared per-request context for a role's sources. */
function buildContext(data: StoreDoc, user: BadgeContext['user']): BadgeContext {
  const lastSeen = user.navLastSeen ?? {};

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
    lastSeenOf: (navKey) => lastSeen[navKey] ?? '',
    incubatorId,
    ownedSpaceIds,
    ownedProgramIds,
    ownedEventIds,
  };
}

/**
 * Compute badge counts for a user. Reads the store once; never throws.
 * Roles with no registered sources (INVESTOR / BUSINESS) get `{}`.
 */
export async function getNavBadges(userId: string): Promise<NavBadgeMap> {
  try {
    const data = await db.read();
    const user = (data.users ?? []).find((u) => u.id === userId);
    if (!user) return {};

    const sources = activitySourcesByRole[user.role] ?? [];
    if (sources.length === 0) return {};

    const ctx = buildContext(data, user);
    const badges: NavBadgeMap = {};
    for (const source of sources) {
      try {
        const n = source.count(ctx);
        if (n > 0) badges[source.navKey] = n;
      } catch {
        // One broken source must not take down the rest — skip it.
      }
    }
    return badges;
  } catch {
    // Requirement: failed counts degrade gracefully — no badge, no crash.
    return {};
  }
}

/**
 * The ONLY write this feature performs: stamp "now" as the user's last-seen
 * time for one nav key. Key-merge only — sibling keys written by another tab
 * are preserved. Fire-and-forget safe: errors are swallowed.
 */
export async function markNavSeen(userId: string, navKey: string): Promise<void> {
  try {
    await db.update((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (!user) return;
      user.navLastSeen = { ...(user.navLastSeen ?? {}), [navKey]: new Date().toISOString() };
    });
  } catch {
    // Non-critical write — a failed stamp just means the badge lingers.
  }
}
