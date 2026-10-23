/** POST /api/hiring/match — `{ text, lang }`: the AI picks the best freelancers for a need. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { matchFreelancers, MAX_NEED_CHARS } from '@/server/hiring/matcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ text: z.string().trim().min(10).max(MAX_NEED_CHARS), lang: z.enum(['fr', 'en', 'ar']) }).strict();

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  // Two model calls per search.
  if (!(await checkRateLimitDistributed(`hire-match:${guard.user.id}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many searches. Try again in an hour.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const r = await matchFreelancers(input.text, input.lang);
  if (r.ok) return json({ need: r.need, matches: r.matches });
  if (r.reason === 'AI_UNAVAILABLE') return jsonError(503, 'AI_UNAVAILABLE', 'The matcher is not available right now');
  return json({ need: null, matches: [], reason: r.reason });
}
