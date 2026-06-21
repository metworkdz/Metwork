import type { Metadata, Viewport } from 'next';
import { Inter, Cairo, Plus_Jakarta_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { ChunkErrorRecovery } from '@/components/pwa/chunk-error-recovery';
import { isLocale, getDirection } from '@/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Standalone shell for the consultant portal, mounted OUTSIDE the `[locale]`
 * segment so it has no locale prefix (its own PWA scope). The UI language is
 * driven entirely by the `metwork_consultant_locale` cookie (set by the in-app
 * language switcher); we read it here to choose messages + text direction and
 * pass them explicitly to NextIntlClientProvider — no per-request i18n config.
 */
const CONSULTANT_LOCALE_COOKIE = 'metwork_consultant_locale';
/** Most consultants are French speakers — the portal defaults to French. */
const PORTAL_DEFAULT_LOCALE = 'fr';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const cairo = Cairo({ subsets: ['arabic', 'latin'], variable: '--font-cairo', display: 'swap' });
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Metwork Mentor',
  applicationName: 'Metwork Mentor',
  // Scoped manifest — distinct from the main app's /manifest.webmanifest.
  manifest: '/mentor.webmanifest',
  appleWebApp: { capable: true, title: 'Metwork Mentor', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0D0D0D',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function MentorDashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CONSULTANT_LOCALE_COOKIE)?.value;
  const locale = raw && isLocale(raw) ? raw : PORTAL_DEFAULT_LOCALE;
  const dir = getDirection(locale);
  const messages = (await import(`../../i18n/messages/${locale}.json`)).default;

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className={cn(inter.variable, cairo.variable, plusJakartaSans.variable, 'min-h-screen bg-[#0D0D0D] font-sans')}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Algiers">
          {children}
        </NextIntlClientProvider>
        <ChunkErrorRecovery />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
