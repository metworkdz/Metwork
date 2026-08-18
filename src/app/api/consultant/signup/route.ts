/**
 * POST /api/consultant/signup  { fullName, position, email, phone, city?, bio? }
 *
 * Public consultant self-signup. Creates a PENDING mentor record (hidden from
 * every public surface until an admin approves it) and sends a sign-in OTP —
 * across WhatsApp + SMS (the phone is collected here) and email — so the new
 * consultant can enter the portal immediately and complete their profile while
 * awaiting review.
 *
 * ALWAYS returns a generic 200 — whether the email was new (record created) or
 * already belonged to a consultant (no record created; a sign-in OTP is issued
 * for the existing account instead). This makes signup enumeration-safe AND
 * gives "I already have an account" users a working path instead of an error.
 *
 * Non-blocking delivery: the record is persisted BEFORE the OTP is sent, and
 * every channel is fire-and-forget. If one (or all) fail, the account still
 * exists — the login page's "resend code" path recovers it.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { consultantSignupSchema } from '@/server/mentors/schemas';
import { createSelfSignupMentor } from '@/server/mentors/service';
import { issueConsultantOtp, consultantOtpKey } from '@/server/mentors/access';
import { stampOtpChannel } from '@/server/auth/otp';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import { sendConsultantOtp } from '@/server/notifications/mock';

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

  // Issue + send the OTP across all channels (fire-and-forget — never blocks
  // the signup result; enumeration-equalized inside issueConsultantOtp). The
  // just-created record carries the phone, so WhatsApp/SMS deliver alongside
  // email — email deliverability alone is unreliable.
  const issued = await issueConsultantOtp(email);
  // Which channel actually took the code. Returned to the client so the
  // "we sent a code to…" copy names the real destination instead of guessing.
  let channel: Awaited<ReturnType<typeof sendConsultantOtp>> = null;
  if (issued) {
    // Awaited: on Vercel an unawaited send is killed when the response returns.
    channel = await sendConsultantOtp({
      email: issued.mentor.email,
      phone: issued.mentor.phone,
      code: issued.code,
    });
    // Stamp the delivering channel on the live OTP so verification knows which
    // contact detail this code actually proves (phone vs email).
    if (channel) await stampOtpChannel(consultantOtpKey(issued.mentor.id), channel);
  }

  // Safe to disclose here: signup always resolves to a real account (created or
  // pre-existing), so naming the channel leaks nothing extra. The login route
  // deliberately stays generic — see its own comment.
  return json({ ok: true, channel });
}
