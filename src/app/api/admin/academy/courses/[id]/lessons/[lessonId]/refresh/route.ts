/** POST /api/admin/academy/courses/{id}/lessons/{lessonId}/refresh — re-read the video's processing state. */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { refreshLessonVideo } from '@/server/academy/videos';
import { requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  const { id, lessonId } = await params;
  const res = await refreshLessonVideo(id, lessonId);
  if (!res.ok) return jsonError(res.code === 'NO_VIDEO' ? 409 : 404, res.code, res.code);
  return json(res.value);
}
