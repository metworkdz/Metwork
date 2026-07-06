/**
 * POST /api/consultant/otp/request  { email }
 *
 * Step 1 of the consultant (mentor) sign-in. Sends a 6-digit code across every
 * available channel (WhatsApp + SMS when a phone is on record, plus email) via
 * the canonical `sendConsultantOtp` — email deliverability alone is unreliable.
 * An unknown email returns an explicit `NO_ACCOUNT` error so the login page can
 * steer the visitor to the self-signup branch — the enumeration reveal is a
 * deliberate product decision for this self-serve portal (rate limits still
 * apply per IP and per email, so bulk probing stays expensive).
 *
 * Reuses the existing OTP infrastructure (`@/server/auth/otp`, hashed at rest,
 * single-use, 10-min expiry, attempt lockout).
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { issueConsultantOtp } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendConsultantOtp } from '@/server/notifications/mock';

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

  const issued = await issueConsultantOtp(email);
  if (!issued) {
    // Explicit signal — the login UI shows "no account for this email" with a
    // create-account CTA. Admin mentors (found email) are unaffected.
    return jsonError(404, 'NO_ACCOUNT', 'No consultant account is linked to this email.');
  }
  // Deliver on every channel (WhatsApp/SMS when a phone is on record + email),
  // so a delayed or spam-filtered email is no longer a dead end.
  sendConsultantOtp({ email: issued.mentor.email, phone: issued.mentor.phone, code: issued.code });

  return json({ ok: true });
}
