/**
 * POST /api/pay/:slug
 *
 * PUBLIC, no session. Drives the hosted-checkout for an incubator payment link.
 * Two actions:
 *   { action: 'init', payerName, payerEmail, locale } → lazily create the
 *        provider transfer (freezing the payer details + payer fee), return the
 *        URL the browser should be sent to.
 *   { action: 'verify' } → ask the provider (server-side) whether payment
 *        completed and settle idempotently if so.
 *
 * Security: rate-limited per IP+slug. The slug is the only credential; the
 * amount charged is the incubator-set base + frozen payer fee (server-computed),
 * never the client. Payment is confirmed only via the provider, never the
 * redirect. Mirrors /api/bookings/pay/[token].
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import {
  initPaymentLinkPayment,
  verifyAndSettlePaymentLink,
} from '@/server/payments/payment-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('init'),
    payerName: z.string().trim().min(2).max(120),
    payerEmail: z.string().trim().email().max(160),
    locale: z.enum(['en', 'fr', 'ar']).default('fr'),
  }),
  z.object({ action: z.literal('verify') }),
]);

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function appBaseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    req.nextUrl.origin ??
    'http://localhost:3000'
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slug || slug.length < 8) return jsonError(404, 'NOT_FOUND', 'Invalid payment link');

  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`pay-link:${slug}:${ip}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  if (input.action === 'init') {
    const result = await initPaymentLinkPayment(
      slug,
      { payerName: input.payerName, payerEmail: input.payerEmail },
      appBaseUrl(req),
      input.locale,
    );
    if (!result.ok) {
      if (result.reason === 'INVALID')   return jsonError(404, 'NOT_FOUND', 'Invalid payment link');
      if (result.reason === 'EXPIRED')   return jsonError(410, 'EXPIRED', 'This payment link has expired');
      if (result.reason === 'PAID')      return json({ state: 'PAID' });
      if (result.reason === 'CANCELLED') return jsonError(409, 'CANCELLED', 'This payment link was cancelled');
      return jsonError(502, 'PROVIDER_FAILED', result.message ?? 'Payment could not be started');
    }
    return json({ redirectUrl: result.redirectUrl });
  }

  // action === 'verify'
  const view = await verifyAndSettlePaymentLink(slug);
  return json({ state: view.state });
}
