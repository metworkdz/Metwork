import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';

const intlMiddleware = createMiddleware(routing);

const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME ?? 'metwork_session';

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
