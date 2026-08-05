/**
 * Canonical mentor → directory-card mapping. Client-safe (no DB import) —
 * used by BOTH `GET /api/mentors/directory` (server) and `MentorCard`
 * (client) so there is exactly one place that decides what a mentor's
 * discovery-card view looks like. Mirrors `getMentorCategoryLabel`'s
 * "pure function over already-fetched data" pattern.
 *
 * Categories resolve through ACTIVE ones only — a deactivated category
 * stays on the mentor record internally but never renders on a public or
 * dashboard surface (same rule the admin category CRUD already documents).
 */
import { resolveMentorPricing } from '@/lib/consultation-pricing';
import { getMentorCategoryLabel } from '@/lib/mentor-categories';
import type { Mentor } from '@/types/mentor';
import type { MentorCategoryRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

export interface MentorDirectoryEntry {
  id: string;
  name: string;
  photoUrl: string | null;
  categories: { id: string; label: string }[];
  /** One-line specialty — sourced from `position`, the field every existing card already uses this way. */
  shortBio: string;
  price: number;
  currency: 'DZD';
  isPriced: boolean;
}

export function resolveMentorCard(
  mentor: Mentor,
  categories: MentorCategoryRecord[],
  locale: Locale,
): MentorDirectoryEntry {
  const activeById = new Map(categories.filter((c) => c.active).map((c) => [c.id, c]));
  const resolvedCategories = (mentor.categoryIds ?? [])
    .map((id) => activeById.get(id))
    .filter((c): c is MentorCategoryRecord => !!c)
    .map((c) => ({ id: c.id, label: getMentorCategoryLabel(c, locale) }));

  const { feePerHour, isPriced } = resolveMentorPricing(mentor);

  return {
    id: mentor.id,
    name: mentor.fullName,
    photoUrl: mentor.avatarUrl ?? mentor.imageUrl ?? null,
    categories: resolvedCategories,
    shortBio: mentor.position,
    price: feePerHour,
    currency: 'DZD',
    isPriced,
  };
}
