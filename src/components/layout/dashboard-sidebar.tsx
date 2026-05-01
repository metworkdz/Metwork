'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { Logo } from '@/components/layout/logo';
import { dashboardNavByRole } from '@/config/navigation';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/auth';

interface DashboardSidebarProps {
  role: UserRole;
}

export function DashboardSidebar({ role }: DashboardSidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const items = dashboardNavByRole[role];

  return (
    <aside className="hidden w-64 shrink-0 border-e border-border bg-background lg:block">
      <div className="flex h-16 items-center border-b border-border px-6">
        <Logo />
      </div>
      <nav className="px-3 py-6" aria-label="Dashboard">
        <ul className="space-y-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== `/dashboard/${role.toLowerCase()}` &&
                pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {Icon && <Icon className="size-4" />}
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
