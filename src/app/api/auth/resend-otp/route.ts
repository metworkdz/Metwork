/**
 * POST /api/auth/resend-otp
 *
 * Re-issues an OTP and delivers it via the requested channel.
 * Always returns 204 — we don't reveal whether the userId exists.
 *
 * Body: { userId, channel?: 'whatsapp' | 'sms' | 'email' }
 * Default channel: 'whatsapp'
 *
 * Rate limiting: max 5 sends per phone per hour, max 10 per IP per hour.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { resendOtpRequestSchema } from '@/server/auth/schemas';
import { db } from '@/server/db/store';
import { issueOtp } from '@/server/auth/otp';
import { reissuePendingOtp } from '@/server/auth/pending-users';
import { sendOtpWhatsApp, sendOtpSms, sendOtpEmail } from '@/server/notifications/mock';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { fromZod, jsonError, noContent } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_WINDOW_MS = 60 * 60_000; // 1 hour

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = resendOtpRequestSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const channel = input.channel ?? 'whatsapp';
  const ip = getClientIp(req);

  // Rate limit per IP (10 per hour)
  if (!(await checkRateLimitDistributed(`ip:${ip}`, 10, RATE_WINDOW_MS))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many OTP requests. Please try again later.');
  }

  // New flow: pending user.
  const pending = await reissuePendingOtp(input.userId);
  if (pending !== null) {
    // Rate limit per phone (5 per hour)
    if (!(await checkRateLimitDistributed(`phone:${pending.phone}`, 5, RATE_WINDOW_MS))) {
      return jsonError(429, 'RATE_LIMITED', 'Too many OTP requests for this number.');
    }

    if (channel === 'whatsapp') sendOtpWhatsApp(pending.phone, pending.code);
    else if (channel === 'sms') sendOtpSms(pending.phone, pending.code);
    else sendOtpEmail(pending.email, pending.code);

    return noContent();
  }

  // Legacy fallback: real user still in PENDING_VERIFICATION state.
  const data = await db.read();
  const user = data.users.find((u) => u.id === input.userId);
  if (user && !user.phoneVerified) {
    // Rate limit per phone (5 per hour)
    if (!(await checkRateLimitDistributed(`phone:${user.phone}`, 5, RATE_WINDOW_MS))) {
      return jsonError(429, 'RATE_LIMITED', 'Too many OTP requests for this number.');
    }

    const otp = await issueOtp(user.id);
    if (channel === 'whatsapp') sendOtpWhatsApp(user.phone, otp.code);
    else if (channel === 'sms') sendOtpSms(user.phone, otp.code);
    else sendOtpEmail(user.email, otp.code);
  }

  return noContent();
}
