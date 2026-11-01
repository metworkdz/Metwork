/** POST /api/consultant/academy/courses/{id}/submit — send the course (or its new modules) to Metwork for review. */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import { redactCourseForBuilder } from '@/server/academy/catalog';
import { editModeFor, submitMentorCourse } from '@/server/academy/studio';
import { requireStudioMentor, studioError } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id } = await params;
  const res = await submitMentorCourse(g.mentorId, id);
  if (!res.ok) return studioError(res.code, res.problems);
  return json({ course: redactCourseForBuilder(res.value), editMode: editModeFor(res.value, g.mentorId) });
}
