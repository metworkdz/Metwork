/**
 * POST /api/auth/forgot-password
 *
 * Always returns 204 — never reveals whether the email is registered.
 * If a matching user exists, a single-use reset token is issued and the reset
 * link is emailed.
 *
 * TWO properties are load-bearing here and they pull against each other:
 *
 *  1. The mail must ACTUALLY SEND. It used to be fire-and-forget, which does
 *     not survive Vercel — the lambda freezes when the response is returned and
 *     the send is abandoned. A reset mail that never arrives locks the user out.
 *
 *  2. The response must not reveal whether the address exists. Awaiting a send
 *     makes the registered branch hundreds of ms slower than the unregistered
 *     one, which would turn this endpoint into the timing oracle its rate
 *     limits exist to prevent.
 *
 * So the send is awaited AND every response is padded to a fixed floor, making
 * the two branches indistinguishable in the common case. See `MIN_RESPONSE_MS`.
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
import { checkRateLimitDistributed } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickLocale(req: NextRequest): string {
  const header = req.headers.get('accept-language')?.toLowerCase() ?? '';
  const lead = header.split(',')[0]?.split('-')[0] ?? '';
  return isLocale(lead) ? lead : clientEnvVars.NEXT_PUBLIC_DEFAULT_LOCALE;
}

/**
 * Every response is padded to this floor, whichever branch it took.
 *
 * Without it, awaiting the mail would make "this address exists" measurably
 * slower — a stronger signal than the token write already leaked. Chosen to sit
 * above a normal issue-token + Resend round trip; a slower-than-floor send can
 * still leak, so this blunts the oracle rather than eliminating it. Combined
 * with the 5/IP/hour and 3/email/hour caps below, an attacker gets too few
 * samples for the residue to be useful.
 *
 * The cost is borne by a once-in-a-blue-moon user action whose result is
 * "check your email", so the latency is not felt.
 */
const MIN_RESPONSE_MS = 900;

/** Sleep out whatever is left of the floor. */
async function padResponse(startedAt: number): Promise<void> {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  // Rate limit: 5 requests per IP per hour. This is intentionally tight —
  // forgot-password is an enumeration vector (timing/response shape can
  // reveal which emails are registered) and a spam vector (every valid
  // email triggers an outbound mail). The endpoint always returns 204,
  // so the only feedback to abusers is the rate-limit response itself.
  const ip = getClientIp(req);
  if (!(await checkRateLimitDistributed(`forgot-password:ip:${ip}`, 5, 60 * 60_000))) {
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
  if (!(await checkRateLimitDistributed(`forgot-password:email:${email}`, 3, 60 * 60_000))) {
    // Return 204 to avoid confirming the email exists. The cap is silent
    // from the user's perspective — they just stop receiving reset mails.
    await padResponse(startedAt);
    return noContent();
  }
  const data = await db.read();
  const user = data.users.find((u) => u.email === email);

  if (user) {
    const token = await issuePasswordResetToken(user.id);
    const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
    const locale = pickLocale(req);
    const link = `${base}/${locale}/reset-password?token=${encodeURIComponent(token)}`;
    // AWAITED: unawaited, this never left the lambda in production. The sender
    // self-catches, so a mail failure cannot change the response — surfacing it
    // would itself confirm the address exists.
    await sendPasswordResetEmail(user.email, link);
  }

  await padResponse(startedAt);
  return noContent();
}
