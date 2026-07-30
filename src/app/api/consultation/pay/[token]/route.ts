/**
 * POST /api/consultation/pay/:token
 *
 * PUBLIC, no session. Drives the guest hosted-checkout for an already-approved
 * consultation. Two actions:
 *   { action: 'init' }   → lazily create the provider transfer, return the URL
 *                          the browser should be sent to.
 *   { action: 'verify' } → ask the provider (server-side) whether payment
 *                          completed and settle idempotently if so.
 *
 * Security: rate-limited per IP+token. The token is the only credential; the
 * amount is read from the booking (server-computed at approval), never the
 * client. Payment is confirmed only via the provider, never the redirect.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import {
  initDirectPayment,
  verifyAndSettleDirectPayment,
} from '@/server/consultations/direct-payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.enum(['init', 'verify']) });

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
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 8) return jsonError(404, 'NOT_FOUND', 'Invalid payment link');

  const ip = getClientIp(req);
  // 20 attempts / token / hour is plenty for retries after a decline while
  // throttling anyone probing tokens.
  if (!(await checkRateLimitDistributed(`consult-pay:${token}:${ip}`, 20, 60 * 60_000))) {
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
    const result = await initDirectPayment(token, appBaseUrl(req));
    if (!result.ok) {
      if (result.reason === 'INVALID')   return jsonError(404, 'NOT_FOUND', 'Invalid payment link');
      if (result.reason === 'EXPIRED')   return jsonError(410, 'EXPIRED', 'This payment link has expired');
      if (result.reason === 'CONFIRMED') return json({ state: 'CONFIRMED' });
      if (result.reason === 'REJECTED')  return jsonError(409, 'REJECTED', 'This request was declined');
      return jsonError(502, 'PROVIDER_FAILED', result.message ?? 'Payment could not be started');
    }
    return json({ redirectUrl: result.redirectUrl });
  }

  // action === 'verify'
  const view = await verifyAndSettleDirectPayment(token);
  return json({ state: view.state });
}
