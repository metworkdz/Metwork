/**
 * POST /api/consultant/otp/request  { email }
 *
 * Step 1 of the consultant (mentor) email → OTP sign-in. Emails a 6-digit code
 * to the address an admin assigned to the mentor record. ALWAYS returns a
 * generic 200 — the response and timing are identical whether or not the email
 * matches a mentor (enumeration protection). Rate-limited per IP and per email.
 *
 * Reuses the existing OTP infrastructure (`@/server/auth/otp`, hashed at rest,
 * single-use, 10-min expiry, attempt lockout) and the existing OTP email sender.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { issueConsultantOtp } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendOtpEmail } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email().max(200),
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

  // Two independent rate limits: blunt per-IP (anti-spray) + targeted per-email.
  if (!(await checkRateLimitDistributed(`consultant-otp:ip:${ip}`, 10, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
  if (!(await checkRateLimitDistributed(`consultant-otp:email:${email}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  // Always issues (matched → real mentor key, unmatched → sentinel) so timing
  // does not leak whether the email exists.
  const issued = await issueConsultantOtp(email);
  if (issued && issued.mentor.email) {
    sendOtpEmail(issued.mentor.email, issued.code);
  }

  // Generic response — never reveal whether the email matched a consultant.
  return json({ ok: true });
}
