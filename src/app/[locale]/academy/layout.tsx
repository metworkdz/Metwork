import { Suspense } from 'react';
import type { Metadata } from 'next';
import { isAcademyAnnounced, isAcademyEnabled } from '@/config/feature-flags';
import { PublicShell } from '@/components/layout/public-shell';
import { Footer } from '@/components/layout/footer';
import { AcademyHeader } from '@/components/features/academy/academy-header';
import { getLandingVisibility } from '@/lib/landing-visibility';
import { ACADEMY_THEME_BOOTSTRAP, ACADEMY_THEME_ROOT_ATTR } from '@/lib/academy-theme';
import { ReferralCapture } from '@/components/features/academy/referral-capture';

/** Open by direct link before the public launch: testers can reach it, search engines must not list it. */
export const metadata: Metadata = isAcademyAnnounced() ? {} : { robots: { index: false, follow: false } };

/**
 * Startup Academy frame. With `isAcademyEnabled()` off, /academy is a 404 inside
 * the normal marketing frame. Once on, the Academy has its own bar and its own light/dark theme, scoped to this wrapper.
 */
export default async function AcademyLayout({ children }: { children: React.ReactNode }) {
  if (!isAcademyEnabled()) return <PublicShell>{children}</PublicShell>;

  const landingVisibility = await getLandingVisibility();
  return (
    <div
      {...{ [ACADEMY_THEME_ROOT_ATTR]: '' }}
      // The inline script sets `dark` before paint, so the class differs from the server HTML.
      suppressHydrationWarning
      className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground"
    >
      <script dangerouslySetInnerHTML={{ __html: ACADEMY_THEME_BOOTSTRAP }} />
      <AcademyHeader />
      <Suspense fallback={null}><ReferralCapture /></Suspense>
      <main className="min-w-0 flex-1">{children}</main>
      <Footer landingVisibility={landingVisibility} />
    </div>
  );
}
