/**
 * POST /api/auth/resend-otp
 *
 * Always returns 204 — we don't reveal whether the userId exists.
 *
 * New flow:  `userId` is a pendingUsers id → refresh OTP in-place.
 * Legacy:    `userId` is a real users id still unverified → re-issue via
 *            the otps table (unchanged behaviour).
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { resendOtpRequestSchema } from '@/server/auth/schemas';
import { db } from '@/server/db/store';
import { issueOtp } from '@/server/auth/otp';
import { reissuePendingOtp } from '@/server/auth/pending-users';
import { sendOtpSms, sendOtpEmail } from '@/server/notifications/mock';
import { fromZod, jsonError, noContent } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  // New flow: pending user.
  const pending = await reissuePendingOtp(input.userId);
  if (pending !== null) {
    sendOtpSms(pending.phone, pending.code);
    sendOtpEmail(pending.email, pending.code);
    return noContent();
  }

  // Legacy fallback: real user still in PENDING_VERIFICATION state.
  const data = await db.read();
  const user = data.users.find((u) => u.id === input.userId);
  if (user && !user.phoneVerified) {
    const otp = await issueOtp(user.id);
    sendOtpSms(user.phone, otp.code);
  }

  return noContent();
}
