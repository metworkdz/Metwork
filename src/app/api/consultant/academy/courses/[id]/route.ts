/**
 * GET    /api/consultant/academy/courses/{id} — the builder state, edit mode, publish checks
 * PUT    /api/consultant/academy/courses/{id} — save (what is saved depends on the edit mode)
 * DELETE /api/consultant/academy/courses/{id} — a draft never sent to review
 */
import type { NextRequest } from 'next/server';
import { json, noContent } from '@/server/http/json';
import { courseDraftSchema, publishProblems, redactCourseForBuilder } from '@/server/academy/catalog';
import { deleteMentorCourse, editModeFor, getStudioCourse, saveMentorCourse } from '@/server/academy/studio';
import { parseBody, requireStudioMentor, studioError } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const view = await getStudioCourse(g.mentorId, id);
  if (!view) return studioError('NOT_FOUND');
  return json(view);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const body = await parseBody(req, courseDraftSchema);
  if (!body.ok) return body.response;
  const res = await saveMentorCourse(g.mentorId, id, body.data);
  if (!res.ok) return studioError(res.code);
  return json({ course: redactCourseForBuilder(res.value), editMode: editModeFor(res.value, g.mentorId), problems: await publishProblems(res.value) });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const res = await deleteMentorCourse(g.mentorId, id);
  if (!res.ok) return studioError(res.code);
  return noContent();
}
