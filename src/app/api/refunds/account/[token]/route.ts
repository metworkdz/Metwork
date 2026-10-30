/**
 * Public, token-gated page API for a GUEST refund (no login).
 *   GET  — what the page shows (amount, item); never the account.
 *   POST — the guest gives a 20-digit RIB / CCP and the holder name.
 * The token is a 256-bit random string whose hash is stored; rate-limited per
 * IP and per token so it cannot be probed or hammered.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, json, jsonError } from '@/server/http/json';
import { getAccountLinkView, submitRefundAccount } from '@/server/refunds/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ip(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await checkRateLimitDistributed(`refund-view:${ip(req)}`, 60, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests');
  }
  return json(await getAccountLinkView(token));
}

const schema = z.object({
  accountType: z.enum(['bank', 'ccp']),
  accountNumber: z.string().max(40),
  holderName: z.string().max(120),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await checkRateLimitDistributed(`refund-submit:${ip(req)}`, 20, 10 * 60_000))
    || !(await checkRateLimitDistributed(`refund-submit-token:${token.slice(0, 16)}`, 10, 10 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  let input;
  try { input = schema.parse(await req.json()); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  const r = await submitRefundAccount(token, input);
  if (!r.ok) {
    if (r.reason === 'INVALID_ACCOUNT_NUMBER') return jsonError(422, r.reason, 'The account number must be 20 digits');
    if (r.reason === 'INVALID_HOLDER_NAME') return jsonError(422, r.reason, 'The account holder name is required');
    if (r.reason === 'EXPIRED') return jsonError(410, 'EXPIRED', 'This link has expired');
    return jsonError(404, 'INVALID', 'This link is not valid');
  }
  return json({ ok: true });
}
