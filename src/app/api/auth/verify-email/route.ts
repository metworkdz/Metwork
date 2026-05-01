/**
 * GET /api/auth/verify-email?token=...&locale=...
 *
 * Consumes a one-shot email-verification token. On success, marks the
 * user emailVerified=true and redirects to /[locale]/login with a flag
 * the UI can use to show a success banner.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { consumeEmailToken } from '@/server/auth/email-verification';
import { clientEnvVars } from '@/lib/env';
import { isLocale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const localeParam = url.searchParams.get('locale') ?? '';
  const locale = isLocale(localeParam) ? localeParam : clientEnvVars.NEXT_PUBLIC_DEFAULT_LOCALE;

  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const target = new URL(`${base}/${locale}/login`);

  if (!token) {
    target.searchParams.set('email_verified', 'invalid');
    return NextResponse.redirect(target);
  }

  const result = await consumeEmailToken(token);
  if (result.ok) {
    target.searchParams.set('email_verified', '1');
  } else {
    target.searchParams.set(
      'email_verified',
      result.reason === 'EXPIRED' ? 'expired' : 'invalid',
    );
  }
  return NextResponse.redirect(target);
}
