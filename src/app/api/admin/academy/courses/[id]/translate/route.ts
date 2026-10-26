/** POST /api/admin/academy/courses/{id}/translate — draft every missing fr/en/ar text with Claude. */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { draftCourseTranslations } from '@/server/academy/translate';
import { getCourseForAdmin, publishProblems, redactCourseForBuilder } from '@/server/academy/catalog';
import { requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  // Each run is a paid API call: a generous ceiling, but a ceiling.
  if (!(await checkRateLimitDistributed(`academy:translate:${g.admin.id}`, 30, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many translation runs. Try again later.');
  }
  const { id } = await params;
  const res = await draftCourseTranslations(id);
  if (!res.ok) {
    const status = res.code === 'NOT_FOUND' ? 404 : res.code === 'UNAVAILABLE' ? 503 : 502;
    return jsonError(status, res.code, res.code);
  }
  const course = await getCourseForAdmin(id);
  return json({ filled: res.filled, course: course && redactCourseForBuilder(course), problems: course ? await publishProblems(course) : [] });
}
