/** POST /api/freelancer/contract/code — `{ contractId, channel }`: send the signing code to the caller's own phone. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { sendSigningCode } from '@/server/freelancer-contracts/service';
import { contractErrorResponse } from '@/server/freelancer-contracts/http';
import { sendOtpSms, sendOtpWhatsApp } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  contractId: z.string().uuid(),
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`freelancer-contract-code:${guard.user.id}`, 6, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many codes. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const r = await sendSigningCode(guard.user.id, parsed.data.contractId);
  if (!r.ok) {
    if (r.reason === 'THROTTLED') {
      return jsonError(429, r.detail.reason === 'LOCKED' ? 'OTP_LOCKED' : 'OTP_THROTTLED', 'Please wait before requesting another code.', { retryAfterSeconds: Math.ceil(r.detail.retryAfterMs / 1000) });
    }
    return contractErrorResponse(r.reason);
  }
  // Awaited (a serverless function stops when it responds); a carrier failure
  // never cancels the issued code.
  try {
    if (parsed.data.channel === 'sms') await sendOtpSms(r.phone, r.code);
    else await sendOtpWhatsApp(r.phone, r.code);
  } catch (err) {
    console.error('[freelancer-contract] code delivery failed', err);
    return jsonError(502, 'DELIVERY_FAILED', 'Could not send the code. Try the other channel.');
  }
  return json({ ok: true, expiresAt: r.expiresAt });
}
