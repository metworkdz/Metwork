import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { readMentorSession } from '@/server/mentors/access';
import { PhoneVerify } from '@/components/features/consultant/portal/phone-verify';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Metwork Mentor',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Consultant phone verification via SMS OTP. Needs a full session (not just a
 * trusted device) — the dashboard entry handles login/PIN unlock, so bounce
 * there when the cookie is missing.
 */
export default async function VerifyPhonePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await readMentorSession())) redirect('/mentordashboard');
  return (
    <div dir="auto" className="relative min-h-[100dvh] overflow-hidden bg-[#FAFAFA] text-[#0D0D0D] antialiased">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-dot-grid opacity-70" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] hero-glow" />
      <Suspense>
        <PhoneVerify />
      </Suspense>
    </div>
  );
}
