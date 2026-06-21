/**
 * POST /api/consultant/otp/verify  { email, code }
 *
 * Step 2 of the consultant email → OTP sign-in. Verifies the 6-digit code
 * (constant-time, single-use, expiry- and attempt-checked via the shared OTP
 * util) and, on success, establishes the consultant portal session.
 *
 * Returns `{ ok, pinSet }` so the client can decide whether to force first-time
 * PIN creation (pinSet=false) or land directly on the dashboard (pinSet=true).
 * Failures collapse to a generic INVALID_OTP so a mismatched email can't be
 * distinguished from a wrong code.
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
} from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email().max(200),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
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

  return json({ ok: true, pinSet: await mentorHasPin(mentor.id) });
}
