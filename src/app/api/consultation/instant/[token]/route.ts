/**
 * POST /api/consultation/instant/:token
 *
 * Member return endpoint for the instant-book, pay-first flow. Verifies and
 * settles, server-side, whichever rail the booking used — never the redirect.
 * Idempotent, so the page may poll it freely.
 *
 *   WALLET   → confirm the top-up intent settled, then debit + confirm
 *              (settleMemberTopUp).
 *   SLICKPAY → ask SlickPay whether the transfer completed, then settle
 *   / STRIPE   (verifyAndSettleDirectPayment). For Stripe the webhook is the
 *              source of truth; this poll is the UX fallback for a payer who
 *              lands back here before the callback arrives.
 *
 * Legacy guest bookings settle via /api/consultation/pay/[token] instead.
 *
 * Body: { action: 'verify' }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { verifyAndSettleByToken } from '@/server/consultations/settle-return';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.enum(['verify']) });

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');

  const { token } = await params;
  if (!token || token.length < 8) return jsonError(404, 'NOT_FOUND', 'Invalid payment link');

  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`instant-settle:${token}:${ip}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  try { schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Shared with the return page — one dispatch, one answer.
  const view = await verifyAndSettleByToken(token);
  if (view.state === 'INVALID') return jsonError(404, 'NOT_FOUND', 'Invalid payment link');
  if (view.state === 'EXPIRED') return jsonError(410, 'EXPIRED', 'This payment link has expired');
  return json({ state: view.state });
}
