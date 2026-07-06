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
    <div dir="auto" className="dark min-h-[100dvh] bg-[#0D0D0D] text-white antialiased">
      <div className="mx-auto max-w-xl px-4">
        <Suspense>
          <PhoneVerify />
        </Suspense>
      </div>
    </div>
  );
}
