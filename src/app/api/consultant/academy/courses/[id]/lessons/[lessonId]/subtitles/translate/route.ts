/** POST /api/consultant/academy/courses/{id}/lessons/{lessonId}/subtitles/translate — draft the other languages (editable lessons only). */
import type { NextRequest } from 'next/server';
import { requireStudioMentor, studioError } from '@/server/academy/http';
import { mentorCanEditLesson } from '@/server/academy/studio';
import { subtitleTranslate } from '@/server/academy/subtitle-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  if (!(await mentorCanEditLesson(g.mentorId, id, lessonId))) return studioError('LOCKED');
  return subtitleTranslate(id, lessonId, `mentor:${g.mentorId}`);
}
