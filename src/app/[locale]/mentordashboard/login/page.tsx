import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { readMentorSession } from '@/server/mentors/access';
import { LanguageSwitcher } from '@/components/features/consultant/portal/language-switcher';
import { EmailOtpSignIn } from '@/components/features/consultant/portal/email-otp-signin';

export const dynamic = 'force-dynamic';

// Scoped PWA — overrides the locale layout's main manifest for this route only.
export const metadata: Metadata = {
  title: 'Metwork Mentor',
  applicationName: 'Metwork Mentor',
  manifest: '/mentor.webmanifest',
  appleWebApp: { capable: true, title: 'Metwork Mentor', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#FAFAFA',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Consultant email → OTP sign-in (auth state machine §2–4). Already-signed-in
 * consultants are bounced to the dashboard. Light, brand-system surface —
 * EmailOtpSignIn owns the centered card; this shell just provides the page
 * background and the top-end language control.
 */
export default async function MentorLoginPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await readMentorSession()) redirect('/mentordashboard');
  return (
    <div dir="auto" className="relative min-h-[100dvh] overflow-hidden bg-[#FAFAFA] text-[#0D0D0D] antialiased">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-dot-grid opacity-70" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] hero-glow" />
      <div className="flex justify-end px-4 pt-4 sm:px-6">
        <LanguageSwitcher tone="light" />
      </div>
      <Suspense>
        <EmailOtpSignIn />
      </Suspense>
    </div>
  );
}
