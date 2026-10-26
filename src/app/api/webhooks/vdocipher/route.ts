/**
 * POST /api/webhooks/vdocipher?token=… — VdoCipher says a video changed state.
 *
 * VdoCipher does not sign webhooks, so the body is only a hint: we take the
 * video id from it and re-read that video from the VdoCipher API with our own
 * secret. A forged call can at most make us re-check a video we already have.
 * The `token` query parameter (VDOCIPHER_WEBHOOK_TOKEN, set in the webhook URL
 * on the VdoCipher dashboard) keeps strangers from even triggering that.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { serverEnvVars } from '@/lib/env';
import { refreshByVideoId } from '@/server/academy/videos';
import { isVdoCipherId } from '@/server/academy/video/vdocipher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected) return process.env.NODE_ENV !== 'production';
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!tokenMatches(req.nextUrl.searchParams.get('token'), serverEnvVars.VDOCIPHER_WEBHOOK_TOKEN)) {
    return jsonError(401, 'UNAUTHORIZED', 'Bad token');
  }
  if (!(await checkRateLimitDistributed('academy:vdocipher-webhook', 600, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Slow down');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Expected JSON'); }
  const payload = (body as { payload?: { id?: unknown } })?.payload;
  const videoId = typeof payload?.id === 'string' ? payload.id : null;
  if (!videoId || !isVdoCipherId(videoId)) return json({ ok: true, ignored: true });
  const updated = await refreshByVideoId(videoId);
  return json({ ok: true, updated });
}
