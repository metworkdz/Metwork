/**
 * Trial sprint of a cofounder match — a shared checklist either founder can
 * tick. Only the two people of the match ever read or write it.
 */
import { db, type CofounderSprintRecord } from '@/server/db/store';
import { cofounderRepo } from '@/server/cofounder/repo';
import type { SprintItem } from '@/lib/cofounder-sprint';

/** The two parties of a match the caller belongs to, or null. */
export async function matchParties(userId: string, matchId: string): Promise<[string, string] | null> {
  const m = await cofounderRepo().getMatch(matchId);
  if (!m || (m.userA !== userId && m.userB !== userId)) return null;
  return [m.userA, m.userB];
}

export async function sprintFor(userId: string, matchId: string): Promise<CofounderSprintRecord | null | 'NOT_FOUND'> {
  if (!(await matchParties(userId, matchId))) return 'NOT_FOUND';
  return (await db.read()).cofounderSprints?.find((s) => s.matchId === matchId) ?? null;
}

/** Tick or untick an item. The sprint starts with the first tick (or an explicit start). */
export async function setSprintItem(userId: string, matchId: string, item: SprintItem | null, done: boolean): Promise<CofounderSprintRecord | null> {
  const parties = await matchParties(userId, matchId);
  if (!parties) return null;
  const now = new Date().toISOString();
  return db.update((d) => {
    const list = (d.cofounderSprints ??= []);
    let s = list.find((x) => x.matchId === matchId);
    if (!s) {
      s = { matchId, parties, startedAt: now, done: {}, updatedAt: now };
      list.push(s);
    }
    if (item) {
      if (done) s.done[item] = { by: userId, at: now };
      else delete s.done[item];
    }
    s.updatedAt = now;
    return { ...s, done: { ...s.done } };
  });
}
