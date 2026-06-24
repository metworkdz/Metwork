import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';
import { locales, defaultLocale } from './config';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  // On first visit (no NEXT_LOCALE cookie) the middleware negotiates the
  // locale from the request's Accept-Language header, mapping unsupported
  // languages to `defaultLocale`. Once the user picks a language via the
  // switcher, next-intl persists it in the NEXT_LOCALE cookie and prefers
  // that over the header on subsequent visits. Server-side only — no client
  // language sniffing, no flicker. This is already next-intl's default; set
  // explicitly so it is not accidentally re-shadowed by a next.config redirect.
  localeDetection: true,
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
