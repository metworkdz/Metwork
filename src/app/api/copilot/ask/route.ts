/**
 * POST /api/copilot/ask — `{ question, history?, lang }` → NDJSON stream:
 *   {"type":"text","text":"…"}*            the answer as it is written
 *   {"type":"status","stage":"web"}        the texts didn't cover it: searching the web
 *   {"type":"done","answer":{…},"quota":{…}} segments + numbered sources
 *   {"type":"error","code":"…"}            instead of done, on failure
 * Errors found before anything is generated (quota, validation) are plain
 * JSON responses with the usual `{ error: { code } }` envelope.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { db } from '@/server/db/store';
import { askCopilot, MAX_QUESTION_CHARS, quotaFor } from '@/server/copilot/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Search planning + a cited answer, and the web fallback when the texts don't cover it.
export const maxDuration = 120;

const bodySchema = z.object({
  question: z.string().trim().min(3).max(MAX_QUESTION_CHARS),
  lang: z.enum(['fr', 'en', 'ar']),
  history: z
    .array(z.object({ question: z.string().max(MAX_QUESTION_CHARS), answer: z.string().max(8000) }).strict())
    .max(6)
    .default([]),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`copilot:${guard.user.id}`, 6, 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many questions in a row. Wait a minute.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = bodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  if (!user) return jsonError(404, 'NOT_FOUND', 'User not found');
  const quota = quotaFor(data, user);
  if (quota.remaining === 0) return jsonError(403, 'QUOTA_EXCEEDED', 'Monthly question limit reached', { limit: quota.limit ?? 0 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      const result = await askCopilot({
        userId: user.id,
        question: input.question,
        history: input.history,
        lang: input.lang,
        onText: (text) => send({ type: 'text', text }),
        onWeb: () => send({ type: 'status', stage: 'web' }),
      });
      send(result.ok ? { type: 'done', answer: result.answer, quota: result.quota } : { type: 'error', code: result.reason });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
