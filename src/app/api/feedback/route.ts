/**
 * POST /api/feedback — body { token, answers: [{ questionId, rating?, text? }] }
 *
 * PUBLIC: a participant answering a training's feedback form through the link
 * they were sent (or the shared link). No account. The signed link is the
 * whole authorisation — see `@/server/feedback/tokens`.
 *
 * Rate-limited per address and per link: a shared link posted in a group chat
 * must not become a way to stuff the results.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';

import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import { submitFeedback } from '@/server/feedback/service';
import { FEEDBACK_LIMITS } from '@/server/feedback/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(1).max(200),
  answers: z.array(z.object({
    questionId: z.string().min(1).max(64),
    rating: z.number().int().min(0).max(FEEDBACK_LIMITS.maxRating).nullable().optional(),
    text: z.string().max(FEEDBACK_LIMITS.text).nullable().optional(),
  })).max(FEEDBACK_LIMITS.questions),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Sized for a whole class answering at the end of a session over the
  // training room's one Wi-Fi (one address), and for a shared link posted in a
  // group of a few dozen — while still stopping a script from stuffing it.
  const ip = clientIp(req);
  const [byIp, byLink] = await Promise.all([
    checkRateLimitDistributed(`feedback-submit:ip:${ip}`, 60, 10 * 60_000),
    checkRateLimitDistributed(`feedback-submit:link:${input.token}`, 200, 10 * 60_000),
  ]);
  if (!byIp || !byLink) {
    return jsonError(429, 'RATE_LIMITED', 'Trop de réponses envoyées. Réessayez dans quelques minutes.');
  }

  const result = await submitFeedback(input.token, input.answers);
  if (!result.ok) {
    switch (result.reason) {
      case 'INVALID': return jsonError(404, 'INVALID_LINK', 'Ce lien n’est pas valide.');
      case 'CLOSED': return jsonError(409, 'CLOSED', 'Ce questionnaire est clôturé.');
      default:
        return jsonError(422, result.reason, 'Réponse incomplète ou invalide.', { questionId: result.questionId });
    }
  }
  return json({ ok: true, updated: result.updated });
}
