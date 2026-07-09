/**
 * POST /api/consultant/phone/request  { channel? }
 *
 * Step 1 of consultant phone verification. Sends a 6-digit OTP to the phone on
 * the consultant's own record — via WHATSAPP by default (the approved
 * `metwork_otp` auth template; SMS delivery to Algerian numbers is unreliable),
 * or via SMS when the consultant explicitly asks (`channel: 'sms'` — the
 * "I didn't get the WhatsApp message" fallback in the UI). Session-guarded —
 * no enumeration surface; the rate limits only bound messaging spend.
 *
 * A carrier failure never corrupts state; the consultant simply requests the
 * other channel. Reuses the shared OTP machinery (hashed at rest, single-use,
 * 10-min expiry, attempt lockout) under the `mentor-phone:` key namespace —
 * both channels verify against the same code.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { requireConsultant, issueConsultantPhoneOtp } from '@/server/mentors/access';
import { findMentorById } from '@/server/mentors/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendOtpSms, sendOtpWhatsApp } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  channel: z.enum(['whatsapp', 'sms']).optional(),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  // Body is optional (legacy clients send none) — default channel: WhatsApp.
  let channel: 'whatsapp' | 'sms' = 'whatsapp';
  try {
    const body: unknown = await req.json();
    channel = schema.parse(body).channel ?? 'whatsapp';
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    // Empty/no-JSON body → keep the default channel.
  }

  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  const phone = mentor.phone?.trim();
  if (!phone) return jsonError(400, 'NO_PHONE', 'No phone number on file. Add one in your profile first.');
  if (mentor.phoneVerified) return jsonError(409, 'ALREADY_VERIFIED', 'This phone number is already verified.');

  const ip = getClientIp(req);
  // Messaging costs money — bound per consultant and per IP.
  if (!(await checkRateLimitDistributed(`consultant-phone-otp:mentor:${guard.mentorId}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
  if (!(await checkRateLimitDistributed(`consultant-phone-otp:ip:${ip}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  const { code } = await issueConsultantPhoneOtp(guard.mentorId);
  // Awaited: on Vercel an unawaited send is killed when the response returns.
  // Each request re-issues (the previous code is invalidated by design), so
  // whichever channel the consultant last asked for carries the valid code.
  if (channel === 'sms') await sendOtpSms(phone, code);
  else await sendOtpWhatsApp(phone, code);

  return json({ ok: true, channel });
}
