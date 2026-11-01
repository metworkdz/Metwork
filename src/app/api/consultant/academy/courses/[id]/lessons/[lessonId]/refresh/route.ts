/** POST — re-read the processing state of a lesson video. */
import type { NextRequest } from 'next/server';
import { json } from '@/server/http/json';
import { mentorLessonRefresh } from '@/server/academy/studio';
import { requireStudioMentor, studioError } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  const res = await mentorLessonRefresh(g.mentorId, id, lessonId);
  if (!res.ok) return studioError(res.code);
  return json(res.value);
}
