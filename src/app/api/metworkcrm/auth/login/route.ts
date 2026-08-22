/**
 * POST /api/metworkcrm/auth/login
 *
 * Email + password only. No OTP, no link to the customer auth flow, no shared
 * cookie. Rate-limited per email AND per IP (dev rules R-18).
 */
import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { json, jsonError, fromZod } from '@/server/http/json';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { verifyPassword } from '@/server/auth/password';
import { getCrmDb } from '@/server/metworkcrm/db/client';
import { internalUsers } from '@/server/metworkcrm/db/schema';
import { crmLoginSchema } from '@/server/metworkcrm/auth/schemas';
import { createCrmSession, setCrmSessionCookie } from '@/server/metworkcrm/auth/session';
import { crmErrorResponse } from '@/server/metworkcrm/http';

// SQLite drivers are Node-only — never Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same message for "no such account" and "wrong password" — never confirm an email exists. */
const GENERIC_FAILURE = 'E-mail ou mot de passe incorrect.';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Corps de requête invalide.');
  }

  const parsed = crmLoginSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);
  const { email, password } = parsed.data;

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  // Two independent budgets: one stops a single account being ground down,
  // the other stops one host spraying many accounts.
  const [emailOk, ipOk] = await Promise.all([
    checkRateLimitDistributed(`crm:login:email:${email}`, 10, 15 * 60_000),
    checkRateLimitDistributed(`crm:login:ip:${ip}`, 30, 15 * 60_000),
  ]);
  if (!emailOk || !ipOk) {
    return jsonError(429, 'RATE_LIMITED', 'Trop de tentatives. Réessayez dans quelques minutes.');
  }

  // Everything below touches the CRM database (a distinct SQLite/Turso
  // connection from the platform's own store — see db/client.ts). A
  // misconfigured or unreachable database must never crash into a raw,
  // non-JSON 500: the login form's `res.json()` would then throw and the
  // user would see a misleading "network error" that has nothing to do with
  // their network. `crmErrorResponse` guarantees a valid JSON envelope no
  // matter what breaks here, and logs the real cause server-side.
  try {
    const rows = await getCrmDb()
      .select()
      .from(internalUsers)
      .where(eq(internalUsers.email, email));
    const user = rows[0];

    // Verify even when the account is missing, against a throwaway hash, so
    // the response time does not reveal whether the email exists.
    const storedHash =
      user?.passwordHash ??
      'scrypt$0000000000000000000000000000000000000000000000000000000000000000$00';
    const passwordOk = await verifyPassword(password, storedHash);

    if (!user || !passwordOk || !user.isActive) {
      return jsonError(401, 'CRM_INVALID_CREDENTIALS', GENERIC_FAILURE);
    }

    const issued = await createCrmSession(user.id, {
      userAgent: req.headers.get('user-agent'),
    });
    await setCrmSessionCookie(issued);

    await getCrmDb()
      .update(internalUsers)
      .set({ lastLoginAt: new Date().toISOString() })
      .where(eq(internalUsers.id, user.id));

    return json({
      ok: true,
      mustChangePassword: user.mustChangePassword,
      // Where the client should go next. The server decides, so the redirect
      // target can never be tampered with client-side.
      next: user.mustChangePassword ? '/metworkcrm/change-password' : '/metworkcrm',
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
