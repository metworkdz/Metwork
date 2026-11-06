/**
 * GET  /api/academy/learn/{courseId}/notes — the learner's own notes on the course.
 * POST /api/academy/learn/{courseId}/notes — { lessonId, positionSec, body }.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/server/http/json';
import { addMyNote, listMyNotes, NOTE_MAX } from '@/server/academy/qa';
import { ACADEMY_ID_RE, isAcademyId, learnerError, parseBody, rateLimited, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ courseId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  const notes = await listMyNotes(g.user, courseId);
  return notes ? json({ notes }) : learnerError('NOT_FOUND');
}

const schema = z.object({
  lessonId: z.string().regex(ACADEMY_ID_RE),
  positionSec: z.number().min(0).max(24 * 3600),
  body: z.string().trim().min(1).max(NOTE_MAX),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { courseId } = await params;
  if (!isAcademyId(courseId)) return learnerError('NOT_FOUND');
  const limited = await rateLimited(`academy:note:${g.user.id}`, 60, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await addMyNote(g.user, { courseId, ...body.data });
  return res.ok ? json({ note: res.note }, { status: 201 }) : learnerError(res.code);
}
