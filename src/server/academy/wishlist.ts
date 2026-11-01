/**
 * The learner's Academy wishlist: published course ids on their account,
 * newest first. A wishlisted course notifies them when a module goes live.
 */
import { db } from '@/server/db/store';

export const WISHLIST_MAX = 100;

export async function setWishlisted(userId: string, courseId: string, on: boolean): Promise<{ ok: true; wishlisted: boolean } | { ok: false; code: 'NOT_FOUND' | 'FULL' }> {
  const d0 = await db.read();
  const course = d0.academyCourses?.find((c) => c.id === courseId);
  // Only published courses can be added; removing always works (an archived one too).
  if (on && course?.status !== 'PUBLISHED') return { ok: false, code: 'NOT_FOUND' };
  return db.update((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u) return { ok: false as const, code: 'NOT_FOUND' as const };
    const list = (u.academyWishlist ?? []).filter((id) => id !== courseId);
    if (on) {
      if (list.length >= WISHLIST_MAX) return { ok: false as const, code: 'FULL' as const };
      list.unshift(courseId);
    }
    u.academyWishlist = list;
    return { ok: true as const, wishlisted: on };
  });
}

export async function wishlistIds(userId: string): Promise<string[]> {
  return (await db.read()).users.find((u) => u.id === userId)?.academyWishlist ?? [];
}

export async function setRemindersOff(userId: string, off: boolean): Promise<void> {
  await db.update((d) => {
    const u = d.users.find((x) => x.id === userId);
    if (u) u.academyRemindersOff = off;
  });
}
