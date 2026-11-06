/**
 * GET  /api/academy/learn/{courseId}/quiz/{moduleId} — the quiz, without its answers.
 * POST /api/academy/learn/{courseId}/quiz/{moduleId} — { answers: { questionId: optionIndex } } → score.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { getLearnerQuiz, submitQuizAttempt } from '@/server/academy/quiz';
import { isAcademyId, learnerError, parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseId: string; moduleId: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId, moduleId } = await params;
  if (!isAcademyId(courseId) || !isAcademyId(moduleId)) return learnerError('NOT_FOUND');
  const locale = req.nextUrl.searchParams.get('locale') ?? g.user.locale ?? 'fr';
  const res = await getLearnerQuiz(g.user, courseId, moduleId, locale);
  return res.ok ? json(res.quiz) : learnerError(res.code);
}

const schema = z.object({ answers: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.number().int().min(0).max(9)) });

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId, moduleId } = await params;
  if (!isAcademyId(courseId) || !isAcademyId(moduleId)) return learnerError('NOT_FOUND');
  const limited = await rateLimited(`academy:quiz:${g.user.id}:${moduleId}`, 10, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await submitQuizAttempt(g.user, courseId, moduleId, body.data.answers);
  return res.ok ? json(res.outcome) : learnerError(res.code);
}
