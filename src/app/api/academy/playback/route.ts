/**
 * POST /api/academy/playback — { courseId, lessonId } → a short-lived playback
 * token for THIS viewer, with their watermark. Opening a lesson replaces the
 * account's other stream (one device at a time).
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { lessonAccess } from '@/server/academy/access';
import { academyRepo } from '@/server/academy/repo';
import { getVideoProvider, PLAYBACK_TOKEN_TTL_SEC } from '@/server/academy/video';
import { watermarkLabel } from '@/server/academy/watermark';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const schema = z.object({ courseId: ID, lessonId: ID });

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  // Watching normally opens a handful of lessons an hour; a scraper opens hundreds.
  if (!(await checkRateLimitDistributed(`academy:playback:${g.user.id}`, 80, 60 * 60_000))) {
    console.warn('[academy] playback rate limit hit', { userId: g.user.id });
    return jsonError(429, 'RATE_LIMITED', 'Too many lessons opened. Take a break and try again later.');
  }
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const access = await lessonAccess(g.user, body.data.courseId, body.data.lessonId);
  if (!access.ok) return jsonError(access.code === 'LOCKED' ? 403 : 404, access.code, access.code);

  const label = watermarkLabel(g.user);
  const [token, streamId, progress] = await Promise.all([
    getVideoProvider().createPlaybackToken({ videoId: access.lesson.videoId!, watermark: label, ttlSec: PLAYBACK_TOKEN_TTL_SEC }),
    academyRepo().startStream(g.user.id, { courseId: access.course.id, lessonId: access.lesson.id }),
    academyRepo().progressFor(g.user.id, access.course.id),
  ]);
  const resumeAt = progress.find((p) => p.lessonId === access.lesson.id)?.positionSec ?? 0;
  return json({
    provider: getVideoProvider().code,
    otp: token.otp,
    playbackInfo: token.playbackInfo,
    expiresAt: token.expiresAt,
    streamId,
    // Shown by the local mock player only; VdoCipher draws it inside the DRM stream.
    watermark: getVideoProvider().code === 'mock' ? label : undefined,
    resumeAt: resumeAt < access.lesson.durationSec - 10 ? resumeAt : 0,
    durationSec: access.lesson.durationSec,
  });
}
