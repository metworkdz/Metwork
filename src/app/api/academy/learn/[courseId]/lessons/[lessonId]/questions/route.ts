/**
 * GET  /api/academy/learn/{courseId}/lessons/{lessonId}/questions — the lesson's Q&A (learners of the course).
 * POST same — { body, parentId? }: a question, or an answer under one.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { listLessonQuestions, postAsLearner, POST_MAX } from '@/server/academy/qa';
import { isAcademyId, learnerError, parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseId: string; lessonId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId, lessonId } = await params;
  if (!isAcademyId(courseId) || !isAcademyId(lessonId)) return learnerError('NOT_FOUND');
  const res = await listLessonQuestions(g.user, courseId, lessonId);
  return res.ok ? json({ questions: res.questions }) : learnerError(res.code);
}

const schema = z.object({
  body: z.string().trim().min(1).max(POST_MAX),
  parentId: z.string().uuid().nullable().default(null),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId, lessonId } = await params;
  if (!isAcademyId(courseId) || !isAcademyId(lessonId)) return learnerError('NOT_FOUND');
  const limited = await rateLimited(`academy:qa:${g.user.id}`, 20, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await postAsLearner(g.user, { courseId, lessonId, ...body.data });
  return res.ok ? json({ id: res.post.id }, { status: 201 }) : learnerError(res.code);
}
