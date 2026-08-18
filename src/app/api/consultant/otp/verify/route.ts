/**
 * POST /api/consultant/otp/verify  { email, code, rememberDevice? }
 *
 * Step 2 of the consultant email → OTP sign-in. Verifies the 6-digit code
 * (constant-time, single-use, expiry- and attempt-checked via the shared OTP
 * util) and, on success, establishes the consultant portal session.
 *
 * Returns `{ ok, pinSet }` so the client can decide whether to force first-time
 * PIN creation (pinSet=false) or land directly on the dashboard (pinSet=true).
 * Failures collapse to a generic INVALID_OTP so a mismatched email can't be
 * distinguished from a wrong code.
 *
 * A confirmed code also proves ONE contact detail — whichever channel actually
 * delivered it (stamped at send time):
 *   - whatsapp / sms → the phone is real     → `phoneVerified = true`, and a
 *                      follow-up link is emailed so the address gets proven too.
 *   - email          → the address is real   → `emailVerified = true`; the phone
 *                      stays UNVERIFIED because nothing ever reached it.
 *
 * `rememberDevice` opts this browser into the 60-day device-trust token, so the
 * consultant can later sign in with just their PIN. Opt-in only: absent/false
 * leaves the browser untrusted and the session ends as normal.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import {
  findMentorByEmail,
  verifyConsultantOtp,
  mentorHasPin,
  createMentorSession,
  setMentorSessionCookie,
  issueMentorDeviceToken,
  setMentorDeviceCookie,
  consultantOtpKey,
} from '@/server/mentors/access';
import { readOtpChannel } from '@/server/auth/otp';
import { db } from '@/server/db/store';
import { issueMentorEmailToken } from '@/server/mentors/email-verification';
import { sendVerificationEmail } from '@/server/notifications/mock';
import { clientEnvVars } from '@/lib/env';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email().max(200),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  /** Opt in to the 60-day device-trust token on this browser. */
  rememberDevice: z.boolean().optional(),
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

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const ip = getClientIp(req);
  const email = input.email.trim().toLowerCase();

  if (!(await checkRateLimitDistributed(`consultant-otp-verify:ip:${ip}`, 20, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }
  if (!(await checkRateLimitDistributed(`consultant-otp-verify:email:${email}`, 10, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  const mentor = await findMentorByEmail(email);
  // No mentor → no OTP record exists; collapse to the same generic error a wrong
  // code produces so existence is never revealed.
  if (!mentor) return jsonError(401, 'INVALID_OTP', 'Invalid or expired code');

  // Read the delivering channel BEFORE verifying — verifyConsultantOtp marks the
  // record consumed, after which the "latest unconsumed" lookup would miss it.
  const channel = await readOtpChannel(consultantOtpKey(mentor.id));

  const result = await verifyConsultantOtp(mentor.id, input.code);
  if (!result.ok) {
    switch (result.reason) {
      case 'EXPIRED':
        return jsonError(401, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
      case 'TOO_MANY_ATTEMPTS':
        return jsonError(429, 'OTP_LOCKED', 'Too many attempts. Request a new code.');
      default:
        return jsonError(401, 'INVALID_OTP', 'Invalid or expired code');
    }
  }

  const session = await createMentorSession(mentor.id);
  await setMentorSessionCookie(session);

  // Opt-in device trust (60 days). Only ever issued AFTER the code verified.
  if (input.rememberDevice) {
    const device = await issueMentorDeviceToken(mentor.id, req.headers.get('user-agent'));
    await setMentorDeviceCookie(device);
  }

  // The confirmed code proves whichever channel carried it.
  const phoneProven = channel === 'whatsapp' || channel === 'sms';
  const emailProven = channel === 'email';
  if (phoneProven || emailProven) {
    await db.update((d) => {
      const m = (d.mentors ?? []).find((x) => x.id === mentor.id);
      if (!m) return;
      if (phoneProven) m.phoneVerified = true;
      if (emailProven) m.emailVerified = true;
      m.updatedAt = new Date().toISOString();
    });
  }

  // Phone-delivered code → the address is still unproven, so send the
  // verification link. Fire-and-forget: a mail failure must never block a
  // sign-in that already succeeded.
  if (phoneProven && mentor.email && !mentor.emailVerified) {
    void (async () => {
      try {
        const token = await issueMentorEmailToken(mentor.id);
        const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
        sendVerificationEmail(
          mentor.email!.trim(),
          `${base}/api/consultant/verify-email?token=${encodeURIComponent(token)}`,
        );
      } catch { /* never blocks sign-in */ }
    })();
  }

  return json({
    ok: true,
    pinSet: await mentorHasPin(mentor.id),
    phoneVerified: phoneProven || mentor.phoneVerified === true,
    emailVerified: emailProven || mentor.emailVerified === true,
  });
}
