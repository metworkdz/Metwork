/**
 * GET / POST / DELETE /api/consultant/academy/courses/{id}/lessons/{lessonId}/subtitles
 * The mentor's own lessons only; changing them only where the Studio lets them edit.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { requireStudioMentor, studioError } from '@/server/academy/http';
import { mentorCanEditLesson } from '@/server/academy/studio';
import { subtitleDelete, subtitleGet, subtitlePost } from '@/server/academy/subtitle-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; lessonId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  const course = (await db.read()).academyCourses?.find((c) => c.id === id);
  if (!course?.mentorIds.includes(g.mentorId)) return studioError('NOT_FOUND');
  return subtitleGet(req, id, lessonId);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  if (!(await mentorCanEditLesson(g.mentorId, id, lessonId))) return studioError('LOCKED');
  return subtitlePost(req, id, lessonId, `mentor:${g.mentorId}`);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  if (!(await mentorCanEditLesson(g.mentorId, id, lessonId))) return studioError('LOCKED');
  return subtitleDelete(req, id, lessonId);
}
