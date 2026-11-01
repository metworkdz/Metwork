/**
 * GET    /api/academy/reviews/{courseId} — visible reviews (public) and, signed in, whether I may review.
 * POST   same — { rating 1–5, text? }: my review (create or edit).
 * DELETE same — remove my review.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, noContent } from '@/server/http/json';
import { readSession } from '@/server/auth/session';
import { deleteMyReview, listCourseReviews, REVIEW_TEXT_MAX, reviewEligibility, saveReview } from '@/server/academy/reviews';
import { db } from '@/server/db/store';
import { isAcademyEnabled } from '@/config/feature-flags';
import { isAcademyId, learnerError, parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  if (!isAcademyEnabled()) return learnerError('NOT_FOUND');
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  const course = (await db.read()).academyCourses?.find((c) => c.id === courseId && c.status === 'PUBLISHED');
  if (!course) return learnerError('NOT_FOUND');
  const session = await readSession();
  const eligibility = session ? await reviewEligibility(session.user, courseId) : null;
  return json({ reviews: await listCourseReviews(courseId), eligibility });
}

const schema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().max(REVIEW_TEXT_MAX).nullable().default(null),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  const limited = await rateLimited(`academy:review:${g.user.id}`, 10, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await saveReview(g.user, courseId, body.data);
  return res.ok ? json({ ok: true }) : learnerError(res.code);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  return (await deleteMyReview(g.user.id, courseId)) ? noContent() : learnerError('NOT_FOUND');
}
