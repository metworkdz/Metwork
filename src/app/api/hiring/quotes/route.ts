/** POST /api/hiring/quotes — ask a freelancer for a quote; opens the conversation. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { getTranslations } from 'next-intl/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { requestQuote } from '@/server/hiring/quotes';
import { messagingErrorResponse, withMessaging } from '@/server/messaging/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  freelancerId: z.string().min(1).max(80),
  gigId: z.string().min(1).max(80).nullable().default(null),
  title: z.string().trim().min(3).max(120),
  details: z.string().trim().min(10).max(3000),
  budget: z.number().int().positive().max(100_000_000).nullable().default(null),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  lang: z.enum(['fr', 'en', 'ar']).default('fr'),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`hire-quote:${guard.user.id}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  // The first message is written in the founder's language.
  const t = await getTranslations({ locale: input.lang, namespace: 'hiring' });
  return withMessaging(async () => {
    const { lang: _lang, ...quote } = input;
    const r = await requestQuote(guard.user.id, quote, { locale: input.lang, budget: t('msgBudget'), deadline: t('msgDeadline') });
    if (r.ok) return json({ quoteId: r.quoteId, conversationId: r.conversationId }, { status: 201 });
    if (r.reason === 'QUOTE_LIMIT') return jsonError(403, 'QUOTE_LIMIT', 'Monthly quote-request limit reached', { limit: r.limit ?? 0 });
    return messagingErrorResponse(r.reason, r.limit);
  });
}
