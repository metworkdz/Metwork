/** GET /api/consultant/academy/lessons/{courseId}/{lessonId} — a lesson's Q&A thread, for the course's mentor. */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import { listLessonQuestionsForMentor } from '@/server/academy/qa';
import { isAcademyId, learnerError, requireStudioMentor } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { courseId, lessonId } = await params;
  if (!isAcademyId(courseId) || !isAcademyId(lessonId)) return learnerError('NOT_FOUND');
  const questions = await listLessonQuestionsForMentor(g.mentorId, courseId, lessonId);
  return questions ? json({ questions }) : learnerError('NOT_FOUND');
}
