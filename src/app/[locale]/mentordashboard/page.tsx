import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { ConsultantPortal } from '@/components/features/consultant/consultant-portal';
import {
  readMentorSession,
  readMentorDeviceCookie,
  resolveMentorIdByDeviceToken,
} from '@/server/mentors/access';

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
 * Consultant portal entry (auth state machine §1). Reached at the prefix-free
 * `/mentordashboard` — the middleware rewrites it to `/{locale}/mentordashboard`
 * (locale from the consultant cookie) so the URL stays its own PWA scope.
 *   • valid session            → dashboard (ConsultantPortal fetches /me)
 *   • trusted device, no session → PIN-unlock (ConsultantPortal signed-out branch)
 *   • neither                  → /mentordashboard/login (full email → OTP)
 */
export default async function MentorDashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const mentorId = await readMentorSession();
  if (!mentorId) {
    const deviceCookie = await readMentorDeviceCookie();
    const trusted = deviceCookie ? await resolveMentorIdByDeviceToken(deviceCookie) : null;
    if (!trusted) redirect('/mentordashboard/login');
  }
  return (
    <Suspense>
      <ConsultantPortal />
    </Suspense>
  );
}
