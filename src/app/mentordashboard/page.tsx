import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ConsultantPortal } from '@/components/features/consultant/consultant-portal';
import {
  readMentorSession,
  readMentorDeviceCookie,
  resolveMentorIdByDeviceToken,
} from '@/server/mentors/access';

export const dynamic = 'force-dynamic';

/**
 * Consultant portal entry (auth state machine §1):
 *   • valid session            → dashboard (ConsultantPortal fetches /me)
 *   • trusted device, no session → PIN-unlock (ConsultantPortal signed-out branch)
 *   • neither                  → /mentordashboard/login (full email → OTP)
 */
export default async function MentorDashboardPage() {
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
