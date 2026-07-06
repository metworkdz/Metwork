/**
 * POST /api/consultant/signup  { fullName, position, email, phone, city?, bio? }
 *
 * Public consultant self-signup. Creates a PENDING mentor record (hidden from
 * every public surface until an admin approves it) and emails a sign-in OTP so
 * the new consultant can enter the portal immediately and complete their
 * profile while awaiting review.
 *
 * ALWAYS returns a generic 200 — whether the email was new (record created) or
 * already belonged to a consultant (no record created; a sign-in OTP is issued
 * for the existing account instead). This makes signup enumeration-safe AND
 * gives "I already have an account" users a working path instead of an error.
 *
 * Non-blocking delivery: the record is persisted BEFORE the OTP email is sent,
 * and the send is fire-and-forget. If the email fails, the account still
 * exists — the login page's "resend code" path recovers it.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { consultantSignupSchema } from '@/server/mentors/schemas';
import { createSelfSignupMentor } from '@/server/mentors/service';
import { issueConsultantOtp } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendOtpEmail } from '@/server/notifications/mock';

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

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = consultantSignupSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const ip = getClientIp(req);
  const email = input.email.trim().toLowerCase();

  // Stricter than OTP request — signups create records.
  if (!(await checkRateLimitDistributed(`consultant-signup:ip:${ip}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
  if (!(await checkRateLimitDistributed(`consultant-signup:email:${email}`, 3, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  // Create-if-absent (atomic dedupe inside the store update). When the email
  // already belongs to a consultant we fall through to issuing a SIGN-IN OTP
  // for that account — same generic response either way.
  await createSelfSignupMentor({ ...input, email });

  // Issue + send the OTP (fire-and-forget — never blocks the signup result;
  // enumeration-equalized inside issueConsultantOtp).
  const issued = await issueConsultantOtp(email);
  if (issued && issued.mentor.email) {
    sendOtpEmail(issued.mentor.email, issued.code);
  }

  return json({ ok: true });
}
