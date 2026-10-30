/**
 * POST /api/academy/heartbeat — sent every 30 s while a lesson plays, and on
 * pause / end. Saves the resume point and counts watch time. The time counted
 * is measured on the server since this stream's previous heartbeat; the body
 * only says WHERE in the video the viewer is.
 * 409 STREAM_TAKEN when the same account opened a lesson on another device.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { lessonAccess } from '@/server/academy/access';
import { academyRepo } from '@/server/academy/repo';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const schema = z.object({
  streamId: z.string().uuid(),
  courseId: ID,
  lessonId: ID,
  positionSec: z.number().min(0).max(24 * 3600),
  playing: z.boolean(),
  ended: z.boolean().default(false),
});

/** Africa/Algiers calendar day (UTC+1, no DST). */
function algiersDay(now = new Date()): string {
  return new Date(now.getTime() + 3600_000).toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  if (!(await checkRateLimitDistributed(`academy:hb:${g.user.id}`, 20, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down');
  }
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { streamId, courseId, lessonId, positionSec, playing, ended } = body.data;

  const repo = academyRepo();
  const touch = await repo.touchStream(g.user.id, streamId);
  if (!touch.ok) return jsonError(409, 'STREAM_TAKEN', 'This account is watching on another device');

  const access = await lessonAccess(g.user, courseId, lessonId);
  if (!access.ok) return jsonError(403, access.code, access.code);
  const { lesson, course } = access;

  // Admin review time is not anybody's watch time.
  if (playing && access.access !== 'ADMIN') {
    await repo.addWatch({
      userId: g.user.id, lessonId, courseId,
      mentorId: course.mentorIds[0] ?? 'unknown',
      access: access.access,
      day: algiersDay(),
      elapsedSec: touch.elapsedSec,
      lessonDurationSec: lesson.durationSec,
    });
  }
  const position = Math.min(Math.floor(positionSec), lesson.durationSec || Math.floor(positionSec));
  const completed = ended || (lesson.durationSec > 0 && position >= lesson.durationSec * 0.9);
  await repo.saveProgress({ userId: g.user.id, courseId, lessonId, positionSec: position, completed });
  return json({ ok: true, completed });
}
