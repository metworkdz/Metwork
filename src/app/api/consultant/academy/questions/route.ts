/**
 * GET  /api/consultant/academy/questions — questions on my courses, unanswered first, plus the reviews.
 * POST /api/consultant/academy/questions — { courseId, lessonId, parentId, body }: answer as the mentor.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { db } from '@/server/db/store';
import { postAsMentor, POST_MAX, questionInbox } from '@/server/academy/qa';
import { listReviewsForManagers } from '@/server/academy/reviews';
import { ACADEMY_ID_RE, learnerError, parseBody, rateLimited, requireStudioMentor } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const locale = req.nextUrl.searchParams.get('locale') ?? 'fr';
  const ids = ((await db.read()).academyCourses ?? []).filter((c) => c.mentorIds.includes(g.mentorId)).map((c) => c.id);
  const [questions, reviews] = await Promise.all([
    questionInbox(ids, locale, { includeHidden: false }),
    listReviewsForManagers({ courseIds: ids, includeHidden: false, locale }),
  ]);
  return json({ questions, reviews });
}

const schema = z.object({
  courseId: z.string().regex(ACADEMY_ID_RE),
  lessonId: z.string().regex(ACADEMY_ID_RE),
  parentId: z.string().uuid(),
  body: z.string().trim().min(1).max(POST_MAX),
});

export async function POST(req: NextRequest) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const limited = await rateLimited(`academy:qa:mentor:${g.mentorId}`, 60, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await postAsMentor(g.mentorId, body.data);
  return res.ok ? json({ id: res.post.id }, { status: 201 }) : learnerError(res.code);
}
