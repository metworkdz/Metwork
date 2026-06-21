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
  appleWebApp: { capable: true, title: 'Metwork Mentor', statusBarStyle: 'black-translucent' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0D0D0D',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Consultant email → OTP sign-in (auth state machine §2–4). Already-signed-in
 * consultants are bounced to the dashboard.
 */
export default async function MentorLoginPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await readMentorSession()) redirect('/mentordashboard');
  return (
    <div dir="auto" className="dark min-h-[100dvh] bg-[#0D0D0D] text-white antialiased">
      <div className="mx-auto max-w-xl px-4">
        <div className="flex justify-end pt-3">
          <LanguageSwitcher />
        </div>
        <Suspense>
          <EmailOtpSignIn />
        </Suspense>
      </div>
    </div>
  );
}
