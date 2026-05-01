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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickLocale(req: NextRequest): string {
  const header = req.headers.get('accept-language')?.toLowerCase() ?? '';
  const lead = header.split(',')[0]?.split('-')[0] ?? '';
  return isLocale(lead) ? lead : clientEnvVars.NEXT_PUBLIC_DEFAULT_LOCALE;
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
    input = forgotPasswordRequestSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const email = input.email.trim().toLowerCase();
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
