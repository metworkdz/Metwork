/**
 * POST /api/consultation/instant/:token
 *
 * Member top-up return for the instant-book, pay-first flow (feature-flagged).
 * After a member with insufficient wallet balance completes the SlickPay
 * top-up, they return here; this verifies the top-up settled (server-side, via
 * the top-up intent — never the redirect) and then debits the wallet and
 * confirms the booking. Idempotent.
 *
 * Guests do NOT use this route — they settle via /api/consultation/pay/[token].
 *
 * Body: { action: 'verify' }
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { isInstantBookEnabled, settleMemberTopUp } from '@/server/consultations/instant-book';

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

  const result = await settleMemberTopUp(token);
  if (result.state === 'INVALID') return jsonError(404, 'NOT_FOUND', 'Invalid payment link');
  if (result.state === 'EXPIRED') return jsonError(410, 'EXPIRED', 'This payment link has expired');
  return json({ state: result.state });
}
