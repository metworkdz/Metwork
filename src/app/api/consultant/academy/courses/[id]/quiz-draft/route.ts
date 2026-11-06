/** POST /api/consultant/academy/courses/{id}/quiz-draft — { moduleId, count? }: AI-drafted questions, for modules the mentor may edit. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { editModeFor } from '@/server/academy/studio';
import { draftModuleQuiz } from '@/server/academy/quiz-draft';
import { ACADEMY_ID_RE, parseBody, rateLimited, requireStudioMentor, studioError } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ moduleId: z.string().regex(ACADEMY_ID_RE), count: z.number().int().min(1).max(10).default(5) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const course = (await db.read()).academyCourses?.find((c) => c.id === id);
  if (!course || !course.mentorIds.includes(g.mentorId)) return studioError('NOT_FOUND');
  const mode = editModeFor(course, g.mentorId);
  const mod = course.modules.find((m) => m.id === body.data.moduleId);
  // Same rule as saving: whole draft in FULL mode, only pending modules on a live course.
  if (!mod || !(mode === 'FULL' || (mode === 'ADD_MODULES' && mod.pendingReview))) return studioError('LOCKED');
  const limited = await rateLimited(`academy:quiz-draft:mentor:${g.mentorId}`, 15, 60 * 60_000);
  if (limited) return limited;
  const res = await draftModuleQuiz(id, body.data.moduleId, body.data.count);
  if (!res.ok) return jsonError(res.code === 'NOT_FOUND' ? 404 : res.code === 'UNAVAILABLE' ? 503 : res.code === 'NO_LESSONS' ? 422 : 502, res.code, res.code);
  return json({ language: res.language, questions: res.questions });
}
