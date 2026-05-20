/**
 * POST /api/auth/forgot-password
 *
 * Always returns 204 — never reveals whether the email is registered.
 * If a matching user exists, a single-use reset token is issued and a
 * mock reset link is logged.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { forgotPasswordRequestSchema } from '@/server/auth/schemas';
import { db } from '@/server/db/store';
import { issuePasswordResetToken } from '@/server/auth/password-reset';
import { sendPasswordResetEmail } from '@/server/notifications/mock';
import { fromZod, jsonError, noContent } from '@/server/http/json';
import { clientEnvVars } from '@/lib/env';
import { isLocale } from '@/i18n/config';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickLocale(req: NextRequest): string {
  const header = req.headers.get('accept-language')?.toLowerCase() ?? '';
  const lead = header.split(',')[0]?.split('-')[0] ?? '';
  return isLocale(lead) ? lead : clientEnvVars.NEXT_PUBLIC_DEFAULT_LOCALE;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 requests per IP per hour. This is intentionally tight —
  // forgot-password is an enumeration vector (timing/response shape can
  // reveal which emails are registered) and a spam vector (every valid
  // email triggers an outbound mail). The endpoint always returns 204,
  // so the only feedback to abusers is the rate-limit response itself.
  const ip = getClientIp(req);
  if (!checkRateLimit(`forgot-password:ip:${ip}`, 5, 60 * 60_000)) {
    return jsonError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = forgotPasswordRequestSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const email = input.email.trim().toLowerCase();

  // Per-email cap: max 3 reset emails per address per hour. Prevents an
  // attacker who's iterating a target's known email from flooding their
  // inbox even from rotating IPs.
  if (!checkRateLimit(`forgot-password:email:${email}`, 3, 60 * 60_000)) {
    // Return 204 to avoid confirming the email exists. The cap is silent
    // from the user's perspective — they just stop receiving reset mails.
    return noContent();
  }
  const data = await db.read();
  const user = data.users.find((u) => u.email === email);

  if (user) {
    const token = await issuePasswordResetToken(user.id);
    const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    const locale = pickLocale(req);
    const link = `${base}/${locale}/reset-password?token=${encodeURIComponent(token)}`;
    sendPasswordResetEmail(user.email, link);
  }

  return noContent();
}
