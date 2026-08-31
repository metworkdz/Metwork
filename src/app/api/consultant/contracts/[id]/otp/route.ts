/**
 * POST /api/consultant/contracts/:id/otp
 *
 * Send (or resend) the one-time code that confirms a contract signature.
 *
 * The throttle, the resend cap and the lockout all live in
 * `consultant-contracts/service.ts`, not here — this route only enforces
 * ownership, converts the service's decision into an HTTP status, and delivers
 * the code.
 *
 * DELIVERY IS NON-BLOCKING. A carrier failure never rolls back the issued code:
 * the consultant can fall back to the other channel, and the code they were
 * charged a send for stays valid. WhatsApp first (the approved `metwork_otp`
 * template — SMS to Algerian numbers is unreliable), SMS on explicit request.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { findContractById, sendSigningOtp } from '@/server/consultant-contracts/service';
import { sendOtpSms, sendOtpWhatsApp } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ channel: z.enum(['whatsapp', 'sms']).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  let channel: 'whatsapp' | 'sms' = 'whatsapp';
  try {
    channel = schema.parse(await req.json()).channel ?? 'whatsapp';
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    // No/empty body — keep the default channel.
  }

  // Ownership before anything else: a contract belonging to someone else must
  // be indistinguishable from one that does not exist.
  const contract = await findContractById(id);
  if (!contract || contract.consultantId !== guard.mentorId) {
    return jsonError(404, 'NOT_FOUND', 'Contract not found');
  }

  // Messaging costs money. The service's own resend cap is the correctness
  // gate; this bounds spend across all of one consultant's contracts.
  if (!(await checkRateLimitDistributed(`contract-otp:mentor:${guard.mentorId}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  const result = await sendSigningOtp(id, guard.mentorId);
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Contract not found');
    if (result.reason !== 'THROTTLED') {
      return jsonError(409, 'NOT_PENDING', 'This contract is not awaiting signature.');
    }
    const retryAfterSeconds = Math.ceil(result.detail.retryAfterMs / 1000);
    return jsonError(
      429,
      result.detail.reason === 'LOCKED' ? 'OTP_LOCKED' : 'OTP_THROTTLED',
      'Please wait before requesting another code.',
      { retryAfterSeconds },
    );
  }

  // Awaited: on Vercel an unawaited send is killed when the response returns.
  // Wrapped so a carrier failure cannot undo an already-issued code.
  try {
    if (channel === 'sms') await sendOtpSms(result.phone, result.code);
    else await sendOtpWhatsApp(result.phone, result.code);
  } catch (err) {
    console.error('[consultant/contracts/otp] delivery failed:', err);
    return jsonError(502, 'DELIVERY_FAILED', 'Could not send the code. Try the other channel.');
  }

  return json({ ok: true, channel, expiresAt: result.expiresAt });
}
