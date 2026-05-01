/**
 * POST /api/auth/verify-otp
 *
 * Primary path (new signup flow):
 *   `userId` is a pendingUsers id.  Validates the OTP stored there, then
 *   atomically promotes the record into the real users table, issues an
 *   email-verification link, creates a session, and returns { user, expiresAt }.
 *
 * Legacy fallback:
 *   `userId` is a real users id still in PENDING_VERIFICATION state.
 *   Handled exactly as before so in-flight sessions aren't broken.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { verifyOtpRequestSchema } from '@/server/auth/schemas';
import { db } from '@/server/db/store';
import { verifyOtp } from '@/server/auth/otp';
import { verifyPendingOtp, promotePendingUser } from '@/server/auth/pending-users';
import { issueEmailToken } from '@/server/auth/email-verification';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { toSessionUser } from '@/server/auth/serialize';
import { sendVerificationEmail } from '@/server/notifications/mock';
import { fromZod, json, jsonError } from '@/server/http/json';
import { clientEnvVars } from '@/lib/env';
import type { Locale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildVerifyEmailLink(token: string, locale: Locale): string {
  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&locale=${locale}`;
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
    input = verifyOtpRequestSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // ── New flow: pending user ──────────────────────────────────────────────
  const pendingResult = await verifyPendingOtp(input.userId, input.code);

  if (pendingResult.ok || pendingResult.reason !== 'NOT_FOUND') {
    if (!pendingResult.ok) {
      if (pendingResult.reason === 'TOO_MANY_ATTEMPTS') {
        return jsonError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts, request a new code');
      }
      return jsonError(400, 'INVALID_OTP', 'Invalid or expired code');
    }

    // Promote pending → real user (atomic).
    const user = await promotePendingUser(input.userId);
    if (!user) return jsonError(500, 'INTERNAL_ERROR', 'Failed to create account');

    // Now that we have a real user id, issue the email-verification link.
    const emailToken = await issueEmailToken(user.id);
    sendVerificationEmail(user.email, buildVerifyEmailLink(emailToken, user.locale as Locale));

    const issued = await createSession(user.id);
    await setSessionCookie(issued);

    return json({ user: toSessionUser(user), expiresAt: issued.expiresAt });
  }

  // ── Legacy fallback: real user still in PENDING_VERIFICATION state ──────
  const result = await verifyOtp(input.userId, input.code);
  if (!result.ok) {
    if (result.reason === 'TOO_MANY_ATTEMPTS') {
      return jsonError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts, request a new code');
    }
    return jsonError(400, 'INVALID_OTP', 'Invalid or expired code');
  }

  const user = await db.update((d) => {
    const u = d.users.find((x) => x.id === input.userId);
    if (!u) return null;
    u.phoneVerified = true;
    if (u.status === 'PENDING_VERIFICATION') u.status = 'ACTIVE';
    u.updatedAt = new Date().toISOString();
    return u;
  });

  if (!user) return jsonError(404, 'USER_NOT_FOUND', 'User not found');

  const issued = await createSession(user.id);
  await setSessionCookie(issued);

  return json({ user: toSessionUser(user), expiresAt: issued.expiresAt });
}
