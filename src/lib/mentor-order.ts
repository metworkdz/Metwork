/**
 * The order of mentors on the public site — pure, so the admin page re-sorts
 * after a publish or hide exactly as the server will. The server imports it
 * from here too (server/mentors/order.ts).
 *
 * Positioned mentors first, by position; the rest by date added. Nobody has a
 * position until the admin saves an order, so the default is date added; a
 * mentor added or published later lands at the end; a hidden mentor keeps
 * their position and returns to it when published again.
 */
import { isMentorPubliclyListed } from '@/lib/mentor-approval';

type Orderable = { id: string; createdAt: string; publicOrder?: number | null };

export function compareMentorsByPublicOrder(a: Orderable, b: Orderable): number {
  const pa = typeof a.publicOrder === 'number' ? a.publicOrder : null;
  const pb = typeof b.publicOrder === 'number' ? b.publicOrder : null;
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  if (pa !== null && pb === null) return -1;
  if (pa === null && pb !== null) return 1;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

type AdminOrderable = Orderable & Parameters<typeof isMentorPubliclyListed>[0];

/** The admin page: on-site mentors first, in public order, then hidden and pending ones. */
export function compareMentorsForAdmin(a: AdminOrderable, b: AdminOrderable): number {
  const la = isMentorPubliclyListed(a);
  const lb = isMentorPubliclyListed(b);
  if (la !== lb) return la ? -1 : 1;
  return compareMentorsByPublicOrder(a, b);
}
