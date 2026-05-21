'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, ChevronDown } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Logo } from './logo';
import { LocaleSwitcher } from './locale-switcher';
import { UserMenu } from './user-menu';
import { publicNavItems } from '@/config/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { cn } from '@/lib/utils';

export function Navbar() {
  const t = useTranslations();
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-all duration-200',
        scrolled
          ? 'border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70'
          : 'bg-background',
      )}
    >
      <Container>
        <div className="flex h-16 items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Logo />

            {/* Desktop nav */}
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
              {publicNavItems.map((item) => {
                if (item.children) {
                  const active = item.children.some((c) => pathname === c.href);
                  return (
                    <DropdownMenu key={item.labelKey}>
                      <DropdownMenuTrigger
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none',
                          'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                          'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
                          active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {t(item.labelKey)}
                        <ChevronDown className="size-4 transition-transform data-[state=open]:rotate-180" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-56">
                        {item.children.map((child) => {
                          const Icon = child.icon;
                          return (
                            <DropdownMenuItem key={child.href} asChild>
                              <Link
                                href={child.href}
                                {...(child.external
                                  ? { target: '_blank', rel: 'noopener noreferrer' }
                                  : {})}
                                className={cn(
                                  'flex w-full cursor-pointer items-center gap-2.5',
                                  pathname === child.href && 'text-foreground',
                                )}
                              >
                                {Icon && <Icon className="size-4 text-muted-foreground" />}
                                {t(child.labelKey)}
                              </Link>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }

                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href!}
                    {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={cn(
                      'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t(item.labelKey)}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <div className="hidden items-center gap-2 lg:flex">
              {isAuthenticated && user ? (
                <UserMenu user={user} />
              ) : (
                <>
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/login">{t('nav.login')}</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href="/signup">{t('nav.signup')}</Link>
                  </Button>
                </>
              )}
            </div>

            {/* Mobile menu trigger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={t('nav.openMenu')}
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex h-full w-full max-w-xs flex-col px-0 sm:max-w-sm">
                <MobileNav onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </Container>
    </header>
  );
}

function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pb-4 pt-2">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-4">
        <ul className="space-y-1">
          {publicNavItems.map((item) => {
            if (item.children) {
              return (
                <li key={item.labelKey} className="pt-2">
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(item.labelKey)}
                  </p>
                  <ul className="space-y-1">
                    {item.children.map((child) => {
                      const Icon = child.icon;
                      const active = pathname === child.href;
                      return (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            {...(child.external
                              ? { target: '_blank', rel: 'noopener noreferrer' }
                              : {})}
                            onClick={onNavigate}
                            className={cn(
                              'flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-medium transition-colors hover:bg-accent',
                              active && 'bg-accent',
                            )}
                          >
                            {Icon && <Icon className="size-5 text-muted-foreground" />}
                            {t(child.labelKey)}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            }

            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href!}
                  {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium transition-colors hover:bg-accent',
                    active && 'bg-accent',
                  )}
                >
                  {Icon && <Icon className="size-5 text-muted-foreground" />}
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-4">
        {isAuthenticated && user ? (
          <Button asChild className="w-full" onClick={onNavigate}>
            <Link href={`/dashboard/${user.role.toLowerCase()}`}>{t('nav.dashboard')}</Link>
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" onClick={onNavigate}>
              <Link href="/login">{t('nav.login')}</Link>
            </Button>
            <Button asChild onClick={onNavigate}>
              <Link href="/signup">{t('nav.signup')}</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
