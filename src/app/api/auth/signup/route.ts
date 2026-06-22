/**
 * POST /api/auth/signup
 *
 * Validates the form, checks the real users table for conflicts, then
 * stores the data in `pendingUsers` (not `users`) and sends an OTP via
 * SMS.  No user record is created here — that happens in /api/auth/verify-otp
 * once the code is confirmed.
 *
 * Response: { userId, requiresOtp, maskedPhone }
 * `userId` here is actually the pending-user id; the client passes it back
 * to verify-otp unchanged.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { signupSchema } from '@/lib/validators';
import { db } from '@/server/db/store';
import { hashPassword } from '@/server/auth/password';
import { issuePendingUser } from '@/server/auth/pending-users';
import { maskPhone, maskEmail, normalizePhone } from '@/server/auth/serialize';
import { sendOtpWhatsApp, sendOtpEmail } from '@/server/notifications/mock';
import { fromZod, json, jsonError } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import type { Locale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

function pickLocale(req: NextRequest): Locale {
  const header = req.headers.get('accept-language')?.toLowerCase() ?? '';
  if (header.startsWith('ar')) return 'ar';
  if (header.startsWith('fr')) return 'fr';
  return 'en';
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 signups per IP per hour
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`signup:ip:${ip}`, 5, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'Too many signup attempts. Please try again later.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = signupSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const email = input.email.trim().toLowerCase();
  const phone = normalizePhone(input.phone);

  // Only the real users table is checked for conflicts.  Duplicates in
  // pendingUsers are silently overwritten (same person retrying signup).
  const snapshot = await db.read();
  if (snapshot.users.some((u) => u.email === email)) {
    return jsonError(409, 'EMAIL_EXISTS', 'Email already in use');
  }
  if (snapshot.users.some((u) => normalizePhone(u.phone) === phone)) {
    return jsonError(409, 'PHONE_EXISTS', 'Phone already in use');
  }

  const passwordHash = await hashPassword(input.password);
  const locale = pickLocale(req);

  const { id, otpCode } = await issuePendingUser({
    fullName: input.fullName.trim(),
    email,
    phone,
    passwordHash,
    role: input.role,
    city: input.city,
    locale,
    incubatorName:
      input.role === 'INCUBATOR' || input.role === 'BUSINESS'
        ? input.incubatorName?.trim()
        : undefined,
    website:
      input.role === 'INCUBATOR' || input.role === 'BUSINESS'
        ? input.website?.trim()
        : undefined,
    instagram:
      input.role === 'INCUBATOR' || input.role === 'BUSINESS'
        ? input.instagram?.trim()
        : undefined,
    linkedin: input.role === 'INVESTOR' ? input.linkedin?.trim() : undefined,
    sex: input.sex,
    // Business-specific fields — only carried when role === 'BUSINESS'.
    businessSubType: input.role === 'BUSINESS' ? input.businessSubType : undefined,
    businessIndustry: input.role === 'BUSINESS' ? input.businessIndustry?.trim() : undefined,
    businessPhone: input.role === 'BUSINESS' ? input.businessPhone?.trim() : undefined,
    businessDescription: input.role === 'BUSINESS' ? input.businessDescription?.trim() : undefined,
  });

  // Primary: WhatsApp (Infobip). Secondary: email as reliable fallback.
  sendOtpWhatsApp(phone, otpCode);
  sendOtpEmail(email, otpCode);

  return json(
    { userId: id, requiresOtp: true, maskedPhone: maskPhone(phone), maskedEmail: maskEmail(email) },
    { status: 201 },
  );
}
