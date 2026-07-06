import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getServerSession } from '@/lib/session';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { DashboardTopbar } from '@/components/layout/dashboard-topbar';
import { MobileDashboardHeader } from '@/components/layout/mobile-dashboard-header';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';
import { PendingApprovalBanner } from '@/components/shared/pending-approval-banner';
import { NavBadgesProvider } from '@/hooks/use-nav-badges';
import { getNotificationCounts } from '@/server/notifications/counts';
import { sourcesForRole } from '@/server/notifications/activity-sources';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([getServerSession(), getLocale()]);
  if (!user) redirect(`/${locale}/login`);

  // Server-computed counts seed — never throws (returns {} on any failure),
  // so a broken count can never block the dashboard from rendering. The
  // client provider revalidates after hydration.
  const initialCounts = await getNotificationCounts(user.id);
  const sources = sourcesForRole(user.role).map(({ key, href }) => ({ key, href }));

  return (
    <NavBadgesProvider initialCounts={initialCounts} sources={sources}>
    <div className="flex min-h-screen bg-muted/20">
      <DashboardSidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop chrome (lg+) — unchanged. Hidden below lg. */}
        <DashboardTopbar user={user} />
        {/* Mobile chrome (below lg) — native-app shell. Removed at lg+. */}
        <MobileDashboardHeader user={user} />
        <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <PendingApprovalBanner />
          {children}
          {/* Scroll clearance so the last card never hides behind the fixed
              mobile tab bar (nav content height + its safe-area inset).
              display:none at lg → desktop layout is byte-for-byte unchanged. */}
          <div aria-hidden className="h-[calc(4.5rem+env(safe-area-inset-bottom))] lg:hidden" />
        </main>
        <MobileTabBar role={user.role} />
      </div>
    </div>
    </NavBadgesProvider>
  );
}
