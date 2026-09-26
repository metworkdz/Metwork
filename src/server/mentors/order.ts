/**
 * The order mentors appear in on the public site — set by the admin.
 *
 * One comparator for every list: positioned mentors first, by position; then
 * the rest by date added. Before any order is saved nobody has a position, so
 * the order is exactly what it always was (date added). A mentor added or
 * published later has no position and lands at the end; a hidden mentor keeps
 * theirs, so publishing them again returns them to their place.
 */
import { db } from '@/server/db/store';
import { appendAuditLog } from '@/server/audit/service';
import { isMentorPubliclyListed } from '@/lib/mentor-approval';

export { compareMentorsByPublicOrder, compareMentorsForAdmin } from '@/lib/mentor-order';

export type SaveOrderResult =
  | { ok: true; order: string[] }
  | { ok: false; reason: 'STALE' | 'INVALID' };

/**
 * Save the public order: `ids` must be exactly the mentors on the site right
 * now, each once. A list that differs — an unknown id, a hidden mentor, a
 * duplicate, or one missing because someone was published meanwhile — is
 * refused and nothing is written: the admin reloads and sees the real list.
 */
export async function saveMentorPublicOrder(
  ids: string[],
  admin: { id: string; email: string },
): Promise<SaveOrderResult> {
  const result = await db.update<SaveOrderResult>((d) => {
    if (new Set(ids).size !== ids.length) return { ok: false, reason: 'INVALID' };
    const listed = (d.mentors ?? []).filter(isMentorPubliclyListed);
    const listedIds = new Set(listed.map((m) => m.id));
    if (ids.length !== listedIds.size || ids.some((id) => !listedIds.has(id))) {
      return { ok: false, reason: 'STALE' };
    }
    const now = new Date().toISOString();
    ids.forEach((id, i) => {
      const m = d.mentors.find((x) => x.id === id)!;
      if (m.publicOrder !== i) { m.publicOrder = i; m.updatedAt = now; }
    });
    return { ok: true, order: ids };
  });

  if (result.ok) {
    void appendAuditLog({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'MENTOR_REORDERED',
      targetType: 'mentor',
      targetId: 'public-order',
      details: { order: ids },
    });
  }
  return result;
}
