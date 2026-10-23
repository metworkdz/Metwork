/**
 * Freelancer reviews — written by founders on COMPLETED orders only, so every
 * star is backed by a paid order. Pure; read by the directory and profiles.
 */
import type { db, ServiceOrderRecord } from '@/server/db/store';

type Store = Awaited<ReturnType<typeof db.read>>;

export interface ReviewSummary {
  average: number | null;
  count: number;
  items: { rating: number; comment: string | null; createdAt: string; author: string; title: string }[];
}

/** A freelancer's reviews, newest first, with the average — for the directory and profile. */
export function reviewsOf(data: { serviceOrders?: ServiceOrderRecord[]; users: Store['users'] }, freelancerId: string): ReviewSummary {
  const items = (data.serviceOrders ?? [])
    .filter((o) => o.freelancerId === freelancerId && o.review)
    .sort((a, b) => b.review!.createdAt.localeCompare(a.review!.createdAt))
    .map((o) => ({
      rating: o.review!.rating,
      comment: o.review!.comment,
      createdAt: o.review!.createdAt,
      author: (data.users.find((u) => u.id === o.entrepreneurId)?.fullName ?? '—').split(' ')[0] ?? '—',
      title: o.title,
    }));
  const average = items.length ? Math.round((items.reduce((s, r) => s + r.rating, 0) / items.length) * 10) / 10 : null;
  return { average, count: items.length, items };
}

