/** POST /api/academy/progress — { courseId, lessonId } marks a lesson done ("Marquer comme terminée"). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { lessonAccess } from '@/server/academy/access';
import { academyRepo } from '@/server/academy/repo';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const schema = z.object({ courseId: ID, lessonId: ID });

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const access = await lessonAccess(g.user, body.data.courseId, body.data.lessonId);
  if (!access.ok) return jsonError(403, access.code, access.code);
  const repo = academyRepo();
  const current = (await repo.progressFor(g.user.id, body.data.courseId)).find((p) => p.lessonId === body.data.lessonId);
  await repo.saveProgress({ ...body.data, userId: g.user.id, positionSec: current?.positionSec ?? 0, completed: true });
  return json({ ok: true });
}
