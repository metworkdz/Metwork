/**
 * POST /api/academy/checkout — buy a course or an Academy Pass term.
 * Body: { courseSlug | pass: 'MONTHLY' | 'ANNUAL', method: 'WALLET' | 'CARD', clientReference, locale }
 * WALLET → { state: 'PAID', … }; CARD → { state: 'REDIRECT', redirectUrl }.
 * The price is computed on the server; the body carries none.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { clientEnvVars } from '@/lib/env';
import { startCoursePurchase } from '@/server/academy/orders';
import { startPassPurchase } from '@/server/academy/pass';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  courseSlug: z.string().min(1).max(80).optional(),
  pass: z.enum(['MONTHLY', 'ANNUAL']).optional(),
  method: z.enum(['WALLET', 'CARD']),
  clientReference: z.string().min(8).max(120),
  locale: z.enum(['fr', 'en', 'ar']).default('fr'),
}).refine((b) => Boolean(b.courseSlug) !== Boolean(b.pass), { message: 'Give either courseSlug or pass' });

const STATUS: Record<string, number> = {
  NOT_A_BUYER: 403, COURSE_NOT_FOUND: 404, ALREADY_OWNED: 409, ALREADY_SUBSCRIBED: 409, WALLET_FROZEN: 423, INSUFFICIENT_FUNDS: 402, PROVIDER_FAILED: 502,
};

export async function POST(req: NextRequest) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  if (!(await checkRateLimitDistributed(`academy:checkout:${g.user.id}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const common = {
    user: g.user,
    method: body.data.method,
    clientReference: body.data.clientReference,
    appBaseUrl: clientEnvVars.NEXT_PUBLIC_APP_URL,
    locale: body.data.locale,
  };
  const res = body.data.pass
    ? await startPassPurchase({ ...common, plan: body.data.pass })
    : await startCoursePurchase({ ...common, courseSlug: body.data.courseSlug! });
  if (!res.ok) {
    const details = res.code === 'INSUFFICIENT_FUNDS' ? { balance: res.balance, required: res.required } : undefined;
    return jsonError(STATUS[res.code] ?? 400, res.code, res.code, details);
  }
  return json(res, { status: res.state === 'PAID' ? 201 : 200 });
}
