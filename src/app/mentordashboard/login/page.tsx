import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { readMentorSession } from '@/server/mentors/access';
import { LanguageSwitcher } from '@/components/features/consultant/portal/language-switcher';
import { EmailOtpSignIn } from '@/components/features/consultant/portal/email-otp-signin';

export const dynamic = 'force-dynamic';

/**
 * Consultant email → OTP sign-in (auth state machine §2–4). Already-signed-in
 * consultants are bounced to the dashboard.
 */
export default async function MentorLoginPage() {
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
