/** POST /api/cofounder/agreements/[id]/code — `{ channel }`: send the caller a signing code on their own phone. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { sendSigningCode } from '@/server/cofounder/agreement';
import { agreementErrorResponse } from '@/server/cofounder/agreement-http';
import { sendOtpSms, sendOtpWhatsApp } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  if (!(await checkRateLimitDistributed(`cofounder-agreement-code:${guard.user.id}`, 6, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many codes. Try again later.');
  }
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const parsed = z.object({ channel: z.enum(['whatsapp', 'sms']).default('whatsapp') }).strict().safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const r = await sendSigningCode(guard.user.id, (await params).id);
  if (!r.ok) {
    if (r.reason === 'THROTTLED') {
      return jsonError(429, r.detail.reason === 'LOCKED' ? 'OTP_LOCKED' : 'OTP_THROTTLED', 'Please wait before requesting another code.', { retryAfterSeconds: Math.ceil(r.detail.retryAfterMs / 1000) });
    }
    return agreementErrorResponse(r.reason);
  }
  // Awaited (a serverless function stops when it responds); a carrier failure
  // never cancels the issued code.
  try {
    if (parsed.data.channel === 'sms') await sendOtpSms(r.phone, r.code);
    else await sendOtpWhatsApp(r.phone, r.code);
  } catch (err) {
    console.error('[cofounder-agreement] code delivery failed', err);
    return jsonError(502, 'DELIVERY_FAILED', 'Could not send the code. Try the other channel.');
  }
  return json({ ok: true, expiresAt: r.expiresAt });
}
