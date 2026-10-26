/**
 * POST /api/admin/academy/courses/{id}/lessons/{lessonId}/upload
 * Reserve a direct upload to the video host for this lesson. The browser then
 * POSTs the file straight to the returned URL (Vercel's body limit never applies).
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { createLessonUpload } from '@/server/academy/videos';
import { requireAcademyAdmin } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const g = await requireAcademyAdmin();
  if (!g.ok) return g.response;
  if (!(await checkRateLimitDistributed(`academy:upload:${g.admin.id}`, 120, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many uploads. Try again later.');
  }
  const { id, lessonId } = await params;
  const res = await createLessonUpload(id, lessonId);
  if (!res.ok) return jsonError(404, res.code, 'Lesson not found');
  return json(res.value, { status: 201 });
}
