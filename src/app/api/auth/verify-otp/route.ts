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
import { sendVerificationEmail, sendWelcomeEmail, sendAdminNewIncubatorNotification, sendAdminNewInvestorNotification } from '@/server/notifications/mock';
import { fromZod, json, jsonError } from '@/server/http/json';
import { clientEnvVars } from '@/lib/env';
import { dashboardPathForRole } from '@/lib/dashboard-routes';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { track, identify } from '@/lib/analytics';
import type { Locale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildVerifyEmailLink(token: string, locale: Locale): string {
  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&locale=${locale}`;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * "Book & create an account": claim the booking carried through OTP for the
 * freshly-promoted user, and return where the OTP form should navigate next.
 *  - CARD         → the hosted-checkout pay page for the booking's pay token.
 *  - CONSULTATION → the dashboard consultations view (the request is still
 *                   pending admin approval; the pay link is emailed once
 *                   approved).
 * Re-assignment is guarded: only an unclaimed (userId == null), unsettled GUEST
 * booking is attached — never a settled or already-owned one. The amount is
 * never recomputed from the client; the pay page re-verifies it server-side.
 */
async function attachCarriedBooking(
  carry: { kind: 'CARD' | 'CONSULTATION'; ref: string },
  userId: string,
  fallbackLocale: Locale,
): Promise<string> {
  const now = new Date().toISOString();
  if (carry.kind === 'CARD') {
    const seg = await db.update<string>((d) => {
      const b = d.bookings.find((x) => x.payToken === carry.ref);
      if (!b) return fallbackLocale;
      const claimable =
        !b.userId && !b.settledAt &&
        b.status !== 'CONFIRMED' && b.status !== 'COMPLETED' &&
        b.status !== 'CANCELLED' && b.status !== 'REFUNDED';
      if (claimable) {
        b.userId = userId;
        b.updatedAt = now;
      }
      return (b.bookingLocale ?? fallbackLocale) as Locale;
    });
    return `/${seg}/booking/pay/${carry.ref}`;
  }
  await db.update((d) => {
    const mb = (d.mentorBookings ?? []).find((x) => x.id === carry.ref);
    if (mb && !mb.userId && mb.source === 'guest') {
      mb.userId = userId;
      mb.updatedAt = now;
    }
  });
  return `/${fallbackLocale}/dashboard/entrepreneur/consultations`;
}

export async function POST(req: NextRequest) {
  // Rate limit: 30 attempts per IP per 15 minutes is generous enough to
  // accommodate legitimate typos/retries while making brute-force of a
  // 6-digit OTP infeasible (1 in 1M chance per attempt × 30 attempts =
  // 0.003%). The verifyPendingOtp helper also enforces a per-pending-user
  // attempt counter (5 strikes → invalidate), so this is belt-and-braces.
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`verify-otp:ip:${ip}`, 30, 15 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

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

  // Per-userId cap: 20 attempts per hour. A single OTP only has 6 digits,
  // so an attacker who knows the userId could otherwise burn the whole
  // keyspace. The pending-user attempt counter already invalidates after
  // 5 wrong codes, so 20 is just a hard ceiling against guessing pendingId.
  if (!(await checkRateLimitDistributed(`verify-otp:user:${input.userId}`, 20, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts for this account. Please request a new code.');
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

    const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    const dashboardPath = dashboardPathForRole(user.role);

    // Email-verification link (fire-and-forget)
    const emailToken = await issueEmailToken(user.id);
    sendVerificationEmail(user.email, buildVerifyEmailLink(emailToken, user.locale as Locale));

    // Welcome email (fire-and-forget)
    sendWelcomeEmail({
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      dashboardUrl: `${base}/${user.locale}${dashboardPath}`,
    });

    // Notify admin when a new incubator account is verified (review required).
    if (user.role === 'INCUBATOR') {
      const inc = (await db.read()).incubators.find((i) => i.managerId === user.id);
      sendAdminNewIncubatorNotification({
        fullName:      user.fullName,
        email:         user.email,
        phone:         user.phone ?? undefined,
        userId:        user.id,
        createdAt:     user.createdAt,
        incubatorName: inc?.name,
        website:       inc?.website,
        instagram:     inc?.instagram,
      });
    }

    // Notify admin when a new investor account is verified (review required).
    if (user.role === 'INVESTOR') {
      sendAdminNewInvestorNotification({
        fullName:  user.fullName,
        email:     user.email,
        phone:     user.phone ?? undefined,
        userId:    user.id,
        createdAt: user.createdAt,
        linkedin:  user.linkedin ?? undefined,
      });
    }

    const issued = await createSession(user.id);
    await setSessionCookie(issued);

    // Analytics: this is the moment a user converts from anonymous signup
    // to a real account. Identify them so future events on this distinctId
    // get attributed to the right Person profile, then fire otp_verified.
    // Fire-and-forget — never let analytics block the login response.
    void identify(user.id, {
      role: user.role,
      city: user.city,
      locale: user.locale,
      createdAt: user.createdAt,
    });
    void track({
      event: 'otp_verified',
      distinctId: user.id,
      props: { role: user.role },
    });

    // "Book & create an account": re-assign the carried booking to the new
    // user and tell the OTP form where to go next (pay page / dashboard).
    let redirect: string | undefined;
    if (pendingResult.pending.pendingBooking) {
      redirect = await attachCarriedBooking(
        pendingResult.pending.pendingBooking,
        user.id,
        user.locale as Locale,
      );
    }

    return json({
      user: toSessionUser(user),
      expiresAt: issued.expiresAt,
      ...(redirect ? { redirect } : {}),
    });
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
