/**
 * POST /api/consultant/phone/request
 *
 * Step 1 of consultant phone verification. Sends a 6-digit SMS OTP (Infobip)
 * to the phone on the consultant's own record. Session-guarded — there is no
 * enumeration surface; the rate limits only bound SMS spend.
 *
 * Non-blocking rule: the SMS send is fire-and-forget (same pattern as every
 * OTP sender) — a carrier failure never corrupts state; the consultant simply
 * taps "resend". Reuses the shared OTP machinery (hashed at rest, single-use,
 * 10-min expiry, attempt lockout) under the `mentor-phone:` key namespace.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { requireConsultant, issueConsultantPhoneOtp } from '@/server/mentors/access';
import { findMentorById } from '@/server/mentors/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendOtpSms } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const mentor = await findMentorById(guard.mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Consultant not found');
  const phone = mentor.phone?.trim();
  if (!phone) return jsonError(400, 'NO_PHONE', 'No phone number on file. Add one in your profile first.');
  if (mentor.phoneVerified) return jsonError(409, 'ALREADY_VERIFIED', 'This phone number is already verified.');

  const ip = getClientIp(req);
  // SMS costs money — bound per consultant and per IP.
  if (!(await checkRateLimitDistributed(`consultant-phone-otp:mentor:${guard.mentorId}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
  if (!(await checkRateLimitDistributed(`consultant-phone-otp:ip:${ip}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  const { code } = await issueConsultantPhoneOtp(guard.mentorId);
  sendOtpSms(phone, code);

  return json({ ok: true });
}
