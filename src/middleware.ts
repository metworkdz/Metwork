import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';

const intlMiddleware = createMiddleware(routing);

const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME ?? 'metwork_session';

/**
 * The consultant portal is served at the prefix-free `/mentordashboard` (its own
 * PWA scope) but rendered by the localized route tree. We REWRITE (not redirect)
 * to `/{locale}/mentordashboard`, keeping the public URL clean. The language is
 * the consultant's explicit choice; kept in sync with CONSULTANT_LOCALE_COOKIE
 * in `components/features/consultant/portal/language-switcher.tsx`.
 */
const CONSULTANT_LOCALE_COOKIE = 'metwork_consultant_locale';
/** Most consultants are French speakers — the portal defaults to French. */
const PORTAL_DEFAULT_LOCALE = 'fr';

/** Pages that require authentication */
const PROTECTED_PREFIXES = ['/dashboard'];

/** Pages that should redirect away if user is already authenticated */
const GUEST_ONLY_PREFIXES = ['/login', '/signup', '/forgot-password'];

function stripLocale(pathname: string): { locale: string | null; path: string } {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return { locale: null, path: '/' };
  const [maybeLocale, ...rest] = segments;
  const supported = routing.locales as readonly string[];
  if (maybeLocale && supported.includes(maybeLocale)) {
    return { locale: maybeLocale, path: '/' + rest.join('/') };
  }
  return { locale: null, path: pathname };
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Prefix-free consultant portal: rewrite `/mentordashboard…` to its localized
  // route so the URL stays its own PWA scope. Bypasses next-intl + the auth
  // guards (the portal self-guards via the session-scoped /api/consultant/*).
  if (pathname === '/mentordashboard' || pathname.startsWith('/mentordashboard/')) {
    const supported = routing.locales as readonly string[];
    const cookieLocale = req.cookies.get(CONSULTANT_LOCALE_COOKIE)?.value;
    const portalLocale = cookieLocale && supported.includes(cookieLocale)
      ? cookieLocale
      : PORTAL_DEFAULT_LOCALE;
    const url = req.nextUrl.clone();
    url.pathname = `/${portalLocale}${pathname}`;
    return NextResponse.rewrite(url);
  }

  const { locale, path } = stripLocale(pathname);
  const session = req.cookies.get(AUTH_COOKIE)?.value;
  const localePrefix = locale ? `/${locale}` : '';

  // Auth guard: protected routes
  if (PROTECTED_PREFIXES.some((p) => path.startsWith(p)) && !session) {
    const url = req.nextUrl.clone();
    url.pathname = `${localePrefix}/login`;
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Guest guard: bounce already-authenticated users away from auth pages.
  // We don't decode the session token here (Edge runtime — no crypto), so
  // we redirect to /dashboard and let the dashboard layout redirect to the
  // role-specific sub-path via the requireRole guard.
  if (GUEST_ONLY_PREFIXES.some((p) => path.startsWith(p)) && session) {
    const url = req.nextUrl.clone();
    url.pathname = `${localePrefix || '/en'}/dashboard`;
    return NextResponse.redirect(url);
  }

  return intlMiddleware(req);
}

export const config = {
  // Match all paths except API, static files, and Next.js internals
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
