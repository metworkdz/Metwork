/** POST /api/consultant/academy/courses/{id}/translate — draft missing fr/en/ar texts (drafts only, not live courses). */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { draftCourseTranslations } from '@/server/academy/translate';
import { publishProblems, redactCourseForBuilder } from '@/server/academy/catalog';
import { editModeFor } from '@/server/academy/studio';
import { db } from '@/server/db/store';
import { requireStudioMentor, studioError } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const course = (await db.read()).academyCourses?.find((c) => c.id === id);
  if (!course || !course.mentorIds.includes(g.mentorId)) return studioError('NOT_FOUND');
  // A live course's approved texts change only through Metwork.
  if (editModeFor(course, g.mentorId) !== 'FULL') return studioError('LOCKED');
  // A paid AI call: a tighter ceiling than the admin's.
  if (!(await checkRateLimitDistributed(`academy:translate:mentor:${g.mentorId}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many translation runs. Try again later.');
  }
  const res = await draftCourseTranslations(id);
  if (!res.ok) return jsonError(res.code === 'NOT_FOUND' ? 404 : res.code === 'UNAVAILABLE' ? 503 : 502, res.code, res.code);
  const after = (await db.read()).academyCourses?.find((c) => c.id === id);
  return json({ filled: res.filled, course: after && redactCourseForBuilder(after), editMode: after ? editModeFor(after, g.mentorId) : 'LOCKED', problems: after ? await publishProblems(after) : [] });
}
