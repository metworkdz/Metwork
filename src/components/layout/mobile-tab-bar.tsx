'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { NavBadge } from '@/components/layout/nav-badge';
import { getMobilePrimaryTabs, getMobileMoreItems, getPremiumNav, MORE_NAV } from '@/config/mobile-nav';
import { useNotificationCounts } from '@/hooks/use-notification-counts';
import { LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/auth';
import type { NavItem } from '@/config/navigation';

interface MobileTabBarProps {
  role: UserRole;
}

/**
 * Revolut-style fixed bottom tab bar — mobile only (`lg:hidden`).
 * Surfaces the role's 4 primary destinations plus a "More" sheet for the rest.
 * Desktop is never affected: the whole element is hidden at `lg` and up.
 */
export function MobileTabBar({ role }: MobileTabBarProps) {
  const premium = getPremiumNav(role);
  if (premium) return <PremiumTabBar role={role} nav={premium} />;
  return <ClassicTabBar role={role} />;
}

function ClassicTabBar({ role }: MobileTabBarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const tabs = getMobilePrimaryTabs(role);
  const moreItems = getMobileMoreItems(role);
  const homeHref = `/dashboard/${role.toLowerCase()}`;
  const { badges } = useNotificationCounts();
  // Aggregate for the collapsed state: everything hidden inside the More sheet.
  const moreBadgeTotal = moreItems.reduce((sum, i) => sum + (badges[i.href] ?? 0), 0);
  // A role whose every destination fits in the bar (the freelancer shell) gets
  // no "More" cell — an empty sheet is a dead end. Columns follow the cell
  // count so the tabs span the bar; 4 tabs + More stays the original 5 columns.
  const showMore = moreItems.length > 0;
  const columnCount = tabs.length + (showMore ? 1 : 0);

  const isActive = (href: string) =>
    pathname === href || (href !== homeHref && pathname.startsWith(href));

  // The "More" tab is active when the current route lives in the overflow set.
  const moreActive = moreItems.some(
    (i) => pathname === i.href || (i.href !== homeHref && pathname.startsWith(i.href)),
  );

  return (
    <>
      <nav
        aria-label={t('nav.dashboard')}
        data-app-bottom-nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 shadow-[0_-1px_12px_rgba(13,13,13,0.06)] backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul
          className="mx-auto grid max-w-md"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {tabs.map((item) => (
            <li key={item.href}>
              <TabLink
                item={item}
                active={isActive(item.href)}
                label={t(item.labelKey)}
                badgeCount={badges[item.href] ?? 0}
                badgeLabel={t('nav.badgeNewActivity', { count: badges[item.href] ?? 0 })}
              />
            </li>
          ))}
          {showMore && (
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-label={t(MORE_NAV.labelKey)}
                className={cn(
                  'flex h-[3.25rem] w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors',
                  moreActive ? 'text-primary-600' : 'text-muted-foreground',
                )}
              >
                <span className="relative">
                  {MORE_NAV.icon && (
                    <MORE_NAV.icon className="size-[1.375rem]" strokeWidth={moreActive ? 2.5 : 2} />
                  )}
                  <NavBadge
                    count={moreBadgeTotal}
                    label={t('nav.badgeNewActivity', { count: moreBadgeTotal })}
                    className="absolute -top-1.5 -end-2.5"
                  />
                </span>
                <span className="leading-none">{t(MORE_NAV.labelKey)}</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5"
        >
          <h2 className="mb-4 text-base font-semibold tracking-tight">{t(MORE_NAV.labelKey)}</h2>
          <ul className="grid grid-cols-3 gap-2">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-border p-2 text-center text-xs font-medium transition-colors',
                      active
                        ? 'border-primary-200 bg-primary-50 text-primary-700'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <span className="relative">
                      {Icon && <Icon className="size-5" />}
                      <NavBadge
                        count={badges[item.href] ?? 0}
                        label={t('nav.badgeNewActivity', { count: badges[item.href] ?? 0 })}
                        className="absolute -top-1.5 -end-2.5"
                      />
                    </span>
                    <span className="line-clamp-1 leading-tight">{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">{t('common.changeLanguage')}</span>
            <LocaleSwitcher />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TabLink({
  item,
  active,
  label,
  badgeCount,
  badgeLabel,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  badgeCount: number;
  badgeLabel: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[3.25rem] flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors',
        active ? 'text-primary-600' : 'text-muted-foreground',
      )}
    >
      <span className="relative">
        {Icon && <Icon className="size-[1.375rem]" strokeWidth={active ? 2.5 : 2} />}
        <NavBadge count={badgeCount} label={badgeLabel} className="absolute -top-1.5 -end-2.5" />
      </span>
      <span className="leading-none">{label}</span>
    </Link>
  );
}

/**
 * Premium shell (freelancer + founder): a floating rounded bar — Home · tab ·
 * Copilot as a raised green circle · Messages · More — and a More sheet
 * grouped by job (money, work, compliance, account).
 */
function PremiumTabBar({ role, nav }: { role: UserRole; nav: NonNullable<ReturnType<typeof getPremiumNav>> }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { badges } = useNotificationCounts();
  const homeHref = `/dashboard/${role.toLowerCase()}`;
  const isActive = (href: string) => pathname === href || (href !== homeHref && pathname.startsWith(href));
  const sheetItems = nav.groups.flatMap((g) => g.items);
  const moreActive = sheetItems.some((i) => isActive(i.href));
  const moreBadgeTotal = sheetItems.reduce((sum, i) => sum + (badges[i.href] ?? 0), 0);
  const [home, second, center, messages] = nav.tabs as [NavItem, NavItem, NavItem, NavItem];
  const CenterIcon = center.icon;
  const centerActive = isActive(center.href);

  const side = (item: NavItem) => (
    <li key={item.href}>
      <TabLink
        item={item}
        active={isActive(item.href)}
        label={t(item.labelKey)}
        badgeCount={badges[item.href] ?? 0}
        badgeLabel={t('nav.badgeNewActivity', { count: badges[item.href] ?? 0 })}
      />
    </li>
  );

  return (
    <>
      <nav
        aria-label={t('nav.dashboard')}
        data-app-bottom-nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 lg:hidden"
        style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
      >
        <ul className="pointer-events-auto mx-auto grid h-[4.25rem] max-w-md grid-cols-5 items-center rounded-[1.625rem] border border-border bg-background/95 shadow-[0_10px_30px_rgba(14,59,30,0.14)] backdrop-blur-xl">
          {side(home)}
          {side(second)}
          <li className="flex justify-center">
            <Link
              href={center.href}
              aria-label={t(center.labelKey)}
              aria-current={centerActive ? 'page' : undefined}
              className={cn(
                '-mt-8 flex size-16 items-center justify-center rounded-full border-[5px] border-background bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(26,127,55,0.35)] transition-transform active:scale-95',
                centerActive && 'ring-2 ring-primary/40',
              )}
            >
              {CenterIcon && <CenterIcon className="size-[1.625rem]" strokeWidth={2.2} />}
            </Link>
          </li>
          {side(messages)}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-label={t(MORE_NAV.labelKey)}
              className={cn(
                'flex h-[3.25rem] w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors',
                moreActive ? 'text-primary-600' : 'text-muted-foreground',
              )}
            >
              <span className="relative">
                <LayoutGrid className="size-[1.375rem]" strokeWidth={moreActive ? 2.5 : 2} />
                <NavBadge
                  count={moreBadgeTotal}
                  label={t('nav.badgeNewActivity', { count: moreBadgeTotal })}
                  className="absolute -top-1.5 -end-2.5"
                />
              </span>
              <span className="leading-none">{t(MORE_NAV.labelKey)}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto rounded-t-[1.75rem] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6"
        >
          <h2 className="mb-5 font-display text-2xl font-extrabold tracking-tight">{t('dashboard.navGroup.allTools')}</h2>
          <div className="space-y-5">
            {nav.groups.map((g) => (
              <section key={g.titleKey}>
                <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t(g.titleKey)}</h3>
                <ul className="grid grid-cols-4 gap-x-2 gap-y-3">
                  {g.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className="flex flex-col items-center gap-1.5 text-center text-[0.6875rem] font-medium leading-tight"
                        >
                          <span
                            className={cn(
                              'relative flex size-14 items-center justify-center rounded-[1.125rem] border transition-colors',
                              active ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-border bg-background text-primary',
                            )}
                          >
                            {Icon && <Icon className="size-6" strokeWidth={1.9} />}
                            <NavBadge
                              count={badges[item.href] ?? 0}
                              label={t('nav.badgeNewActivity', { count: badges[item.href] ?? 0 })}
                              className="absolute -top-1 -end-1"
                            />
                          </span>
                          <span className="line-clamp-2 text-foreground">{t(item.labelKey)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">{t('common.changeLanguage')}</span>
            <LocaleSwitcher />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
