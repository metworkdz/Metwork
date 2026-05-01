import type { Metadata, Viewport } from 'next';
import { Inter, Cairo, Space_Grotesk } from 'next/font/google';
import { notFound } from 'next/navigation';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Providers } from '@/components/providers';
import { getServerSession } from '@/lib/session';
import { siteConfig } from '@/config/site';
import { locales, getDirection, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-cairo',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';

  return {
    title: {
      default: `${siteConfig.name} — ${siteConfig.description}`,
      template: `%s · ${siteConfig.name}`,
    },
    description: siteConfig.description,
    applicationName: siteConfig.name,
    authors: [{ name: siteConfig.name, url: siteConfig.url }],
    keywords: [
      'Algeria',
      'startup',
      'entrepreneurs',
      'incubator',
      'coworking',
      'investors',
      'fundraising',
      'Oran',
      'Algiers',
    ],
    openGraph: {
      type: 'website',
      url: siteConfig.url,
      title: siteConfig.name,
      description: siteConfig.description,
      siteName: siteConfig.name,
      locale: isAr ? 'ar_DZ' : locale === 'fr' ? 'fr_DZ' : 'en_US',
      images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: siteConfig.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title: siteConfig.name,
      description: siteConfig.description,
      images: [siteConfig.ogImage],
    },
    icons: {
      icon: [
        { url: siteConfig.favicon, type: 'image/svg+xml' },
      ],
      apple: siteConfig.favicon,
    },
    robots: { index: true, follow: true },
    alternates: {
      canonical: `${siteConfig.url}/${locale}`,
      languages: {
        en: `${siteConfig.url}/en`,
        fr: `${siteConfig.url}/fr`,
        ar: `${siteConfig.url}/ar`,
      },
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1f12' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!(locales as readonly string[]).includes(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const [messages, sessionUser] = await Promise.all([
    getMessages(),
    getServerSession(),
  ]);

  const dir = getDirection(locale);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className={cn(inter.variable, cairo.variable, spaceGrotesk.variable, 'min-h-screen bg-background font-sans')}>
        <Providers locale={locale} messages={messages} initialUser={sessionUser}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
