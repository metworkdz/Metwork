'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Logo } from './logo';
import { LocaleSwitcher } from './locale-switcher';
import { UserMenu } from './user-menu';
import { Link, usePathname } from '@/i18n/routing';
import { dashboardNavByRole } from '@/config/navigation';
import { cn } from '@/lib/utils';
import type { SessionUser } from '@/types/auth';

interface DashboardTopbarProps {
  user: SessionUser;
}

export function DashboardTopbar({ user }: DashboardTopbarProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = dashboardNavByRole[user.role];

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile drawer trigger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('nav.openMenu')}>
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 px-0">
            <div className="px-6 pt-2">
              <Logo />
            </div>
            <nav className="mt-6 px-3" aria-label="Dashboard">
              <ul className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    (item.href !== `/dashboard/${user.role.toLowerCase()}` &&
                      pathname.startsWith(item.href));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary-50 text-primary-700'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {Icon && <Icon className="size-4" />}
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex items-center gap-2">
        <LocaleSwitcher />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
