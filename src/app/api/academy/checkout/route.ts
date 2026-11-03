/**
 * POST /api/academy/checkout — buy a course, an Academy Pass term or a bundle,
 * for yourself or (course / Pass month) as a gift.
 * Body: { courseSlug | pass: 'MONTHLY' | 'ANNUAL' | bundleSlug, gift?: { name, contact, message },
 *         method: 'WALLET' | 'CARD', clientReference, locale }
 * A referral discount comes from the visitor's HttpOnly cookie, never from the body.
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
import { startBundlePurchase } from '@/server/academy/bundles';
import { startGiftPurchase } from '@/server/academy/gifts';
import { REFERRAL_COOKIE } from '@/server/academy/referral';
import { parseBody, requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  courseSlug: z.string().min(1).max(80).optional(),
  pass: z.enum(['MONTHLY', 'ANNUAL']).optional(),
  bundleSlug: z.string().min(1).max(80).optional(),
  gift: z.object({
    name: z.string().trim().min(1).max(80),
    contact: z.string().trim().min(5).max(120),
    message: z.string().max(500).nullable().default(null),
  }).optional(),
  method: z.enum(['WALLET', 'CARD']),
  clientReference: z.string().min(8).max(120),
  locale: z.enum(['fr', 'en', 'ar']).default('fr'),
})
  .refine((b) => [b.courseSlug, b.pass, b.bundleSlug].filter(Boolean).length === 1, { message: 'Give one of courseSlug, pass or bundleSlug' })
  // A gift is a course or ONE Pass month.
  .refine((b) => !b.gift || (!b.bundleSlug && (!b.pass || b.pass === 'MONTHLY')), { message: 'Gifts are a course or a Pass month' });

const STATUS: Record<string, number> = {
  NOT_A_BUYER: 403, COURSE_NOT_FOUND: 404, BUNDLE_NOT_FOUND: 404, BAD_CONTACT: 422, ALREADY_OWNED: 409, ALREADY_SUBSCRIBED: 409, WALLET_FROZEN: 423, INSUFFICIENT_FUNDS: 402, PROVIDER_FAILED: 502,
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
  const referralCode = req.cookies.get(REFERRAL_COOKIE)?.value ?? null;
  const { gift } = body.data;
  const res = gift
    ? await startGiftPurchase({
      ...common, kind: body.data.pass ? 'PASS' : 'COURSE', courseSlug: body.data.courseSlug,
      recipientName: gift.name, recipientContact: gift.contact, message: gift.message,
    })
    : body.data.bundleSlug
      ? await startBundlePurchase({ ...common, bundleSlug: body.data.bundleSlug, referralCode })
      : body.data.pass
        ? await startPassPurchase({ ...common, plan: body.data.pass, referralCode })
        : await startCoursePurchase({ ...common, courseSlug: body.data.courseSlug!, referralCode });
  if (!res.ok) {
    const details = res.code === 'INSUFFICIENT_FUNDS' ? { balance: res.balance, required: res.required } : undefined;
    return jsonError(STATUS[res.code] ?? 400, res.code, res.code, details);
  }
  return json(res, { status: res.state === 'PAID' ? 201 : 200 });
}
