/**
 * POST /api/bookings/pay/:token
 *
 * PUBLIC, no session. Drives the hosted-checkout for a card-settled booking
 * (SPACE / PROGRAM / EVENT) — both guest and registered. Two actions:
 *   { action: 'init' }   → lazily create the provider transfer, return the URL
 *                          the browser should be sent to.
 *   { action: 'verify' } → ask the provider (server-side) whether payment
 *                          completed and settle idempotently if so.
 *
 * Security: rate-limited per IP+token. The token is the only credential; the
 * amount charged is `onlinePaidAmount`, frozen on the booking at intent time
 * (server-computed), never the client. Payment is confirmed only via the
 * provider, never the redirect. Mirrors /api/consultation/pay/[token].
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import {
  initCardBookingPayment,
  verifyAndSettleCardBooking,
} from '@/server/bookings/card-payment';

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
  if (!(await checkRateLimitDistributed(`booking-pay:${token}:${ip}`, 20, 60 * 60_000))) {
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
    const result = await initCardBookingPayment(token, appBaseUrl(req));
    if (!result.ok) {
      if (result.reason === 'INVALID')   return jsonError(404, 'NOT_FOUND', 'Invalid payment link');
      if (result.reason === 'EXPIRED')   return jsonError(410, 'EXPIRED', 'This payment link has expired');
      if (result.reason === 'CONFIRMED') return json({ state: 'CONFIRMED' });
      if (result.reason === 'CANCELLED') return jsonError(409, 'CANCELLED', 'This booking was cancelled');
      if (result.reason === 'SLOT_TAKEN') return jsonError(409, 'SLOT_TAKEN', 'This slot is no longer available');
      return jsonError(502, 'PROVIDER_FAILED', result.message ?? 'Payment could not be started');
    }
    return json({ redirectUrl: result.redirectUrl });
  }

  // action === 'verify'
  const view = await verifyAndSettleCardBooking(token);
  return json({ state: view.state });
}
