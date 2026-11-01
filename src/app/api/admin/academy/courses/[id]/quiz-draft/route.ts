/** POST /api/admin/academy/courses/{id}/quiz-draft — { moduleId, count? }: AI-drafted questions for the builder (nothing saved). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { draftModuleQuiz } from '@/server/academy/quiz-draft';
import { ACADEMY_ID_RE, parseBody, rateLimited, requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ moduleId: z.string().regex(ACADEMY_ID_RE), count: z.number().int().min(1).max(10).default(5) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id } = await params;
  const limited = await rateLimited(`academy:quiz-draft:admin:${g.admin.id}`, 30, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await draftModuleQuiz(id, body.data.moduleId, body.data.count);
  if (!res.ok) return jsonError(res.code === 'NOT_FOUND' ? 404 : res.code === 'UNAVAILABLE' ? 503 : res.code === 'NO_LESSONS' ? 422 : 502, res.code, res.code);
  return json({ language: res.language, questions: res.questions });
}
