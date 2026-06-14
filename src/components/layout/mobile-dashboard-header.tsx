'use client';

import { Logo } from '@/components/layout/logo';
import { NotificationBell } from '@/components/layout/notification-bell';
import { UserMenu } from '@/components/layout/user-menu';
import type { SessionUser } from '@/types/auth';

interface MobileDashboardHeaderProps {
  user: SessionUser;
}

/**
 * Mobile-only dashboard chrome (`lg:hidden`) — a slim sticky app-style bar
 * (logo + notifications + account avatar) that replaces the desktop topbar
 * below the `lg` breakpoint. Each page's own first card (e.g. the welcome /
 * balance card) acts as the summary header, so we deliberately avoid a second
 * greeting here.
 *
 * Desktop is untouched: the desktop `<DashboardTopbar>` stays as-is and this
 * whole element is removed from the layout at `lg` and up.
 */
export function MobileDashboardHeader({ user }: MobileDashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-md lg:hidden">
      <Logo size={26} />
      <div className="flex items-center gap-1">
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
