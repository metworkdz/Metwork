/**
 * GET /api/mentors/directory — lightweight, locale-resolved mentor directory
 * for the discovery UI (MentorGrid/MentorCard). Public — no auth guard, since
 * a directory listing has no user-specific data (works identically for
 * authenticated and unauthenticated callers, matching the existing
 * `GET /api/mentors` route's convention).
 *
 * Neither the public /mentors page nor the dashboard consultations page
 * calls this route directly today — both are RSCs that already hold the
 * full `Mentor[]` they need (for booking) and derive the lightweight card
 * view in-process via the SAME `resolveMentorCard` function this route
 * calls. This endpoint exists as a complete, independently-fetchable
 * contract (e.g. for a future client-only consumer), per the spec.
 */
import type { NextRequest } from 'next/server';
import { listPublicMentors } from '@/server/mentors/service';
import { listActiveMentorCategories } from '@/server/mentor-categories/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { resolveMentorCard } from '@/lib/mentor-directory';
import { json } from '@/server/http/json';
import { isLocale, defaultLocale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const localeParam = searchParams.get('locale') ?? '';
  const locale = isLocale(localeParam) ? localeParam : defaultLocale;

  const categoryParam = searchParams.get('category');
  const categoryFilter = categoryParam
    ? categoryParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const [mentors, categories] = await Promise.all([
    listPublicMentors().then((list) => list.map(toMentorDto)),
    listActiveMentorCategories(),
  ]);

  const items = mentors
    .map((m) => resolveMentorCard(m, categories, locale))
    .filter((entry) => !categoryFilter || entry.categories.some((c) => categoryFilter.includes(c.id)));

  return json({ items, total: items.length });
}
