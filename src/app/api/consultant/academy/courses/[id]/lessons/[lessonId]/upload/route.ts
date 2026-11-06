/** POST — reserve a direct video upload for one of the mentor's editable lessons. */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { mentorLessonUpload } from '@/server/academy/studio';
import { requireStudioMentor, studioError } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const g = await requireStudioMentor();
  if (!g.ok) return g.response;
  if (!(await checkRateLimitDistributed(`academy:upload:mentor:${g.mentorId}`, 60, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many uploads. Try again later.');
  }
  const { id, lessonId } = await params;
  const res = await mentorLessonUpload(g.mentorId, id, lessonId);
  if (!res.ok) return studioError(res.code);
  return json(res.value, { status: 201 });
}
