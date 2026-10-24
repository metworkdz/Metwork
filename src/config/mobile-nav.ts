import {
  MoreHorizontal,
  type LucideIcon,
  MapPin,
  Wallet,
  TrendingUp,
  Rocket,
  Star,
  Calendar,
  Building2,
  Briefcase,
  UsersRound,
  Users,
  BarChart2,
  ArrowUpCircle,
} from 'lucide-react';
import { dashboardNavByRole, type NavItem } from '@/config/navigation';
import type { UserRole } from '@/types/auth';

/**
 * Mobile bottom-tab destinations per role (Revolut-style app shell).
 *
 * These are the 4 *primary* destinations surfaced as bottom tabs below the
 * `lg` breakpoint. The 5th cell is always a "More" trigger that opens a bottom
 * sheet listing every remaining destination from `dashboardNavByRole`.
 *
 * The hrefs here MUST exist in `dashboardNavByRole[role]` — the tab labels and
 * icons are looked up from there so we never duplicate config. This file only
 * decides *which* of the existing destinations get promoted to the bottom bar.
 */
const primaryTabHrefsByRole: Record<UserRole, string[]> = {
  ENTREPRENEUR: [
    '/dashboard/entrepreneur',
    '/dashboard/entrepreneur/bookings',
    // Center tab — consultations promoted from the "More" sheet so booking a
    // session is one tap away (marketplace moved to the overflow sheet).
    '/dashboard/entrepreneur/consultations',
    // Messages over wallet: replies are daily; the wallet badge still shows on "More".
    '/dashboard/entrepreneur/messages',
  ],
  INVESTOR: [
    '/dashboard/investor',
    '/dashboard/investor/startups',
    '/dashboard/investor/saved',
    '/dashboard/investor/meetings',
  ],
  INCUBATOR: [
    '/dashboard/incubator',
    '/dashboard/incubator/clients',
    '/dashboard/incubator/bookings',
    '/dashboard/incubator/wallet',
  ],
  FREELANCER: [
    '/dashboard/freelancer',
    '/dashboard/freelancer/invoices',
    '/dashboard/freelancer/payment-links',
    '/dashboard/freelancer/messages',
  ],
  ADMIN: [
    '/dashboard/admin',
    '/dashboard/admin/users',
    '/dashboard/admin/bookings',
    '/dashboard/admin/analytics',
  ],
};

/**
 * Premium shell (freelancer + founder): a floating bar of Home · tab ·
 * Copilot (green centre circle) · Messages · More, and a More sheet grouped
 * by job. `tabs` are 4 hrefs in bar order (the 3rd renders as the centre
 * circle); every other nav item lands in a group — anything not listed in a
 * group falls into the last one, so no destination is ever unreachable.
 */
export interface PremiumNavGroup {
  titleKey: string;
  hrefs: string[];
}

export interface PremiumNav {
  tabs: [string, string, string, string];
  groups: PremiumNavGroup[];
}

const F = '/dashboard/freelancer';
const E = '/dashboard/entrepreneur';

export const premiumNavByRole: Partial<Record<UserRole, PremiumNav>> = {
  FREELANCER: {
    tabs: [F, `${F}/orders`, `${F}/copilot`, `${F}/messages`],
    groups: [
      { titleKey: 'dashboard.navGroup.money', hrefs: [`${F}/wallet`, `${F}/invoices`, `${F}/payment-links`, `${F}/clients`] },
      { titleKey: 'dashboard.navGroup.work', hrefs: [`${F}/gigs`, `${F}/projects`, `${F}/cofounder`, `${F}/bookings`, `${F}/consultations`] },
      { titleKey: 'dashboard.navGroup.compliance', hrefs: [`${F}/taxes`, `${F}/contract`, `${F}/membership`] },
      { titleKey: 'dashboard.navGroup.account', hrefs: [`${F}/profile`, `${F}/settings`] },
    ],
  },
  ENTREPRENEUR: {
    tabs: [E, `${E}/hire`, `${E}/copilot`, `${E}/messages`],
    groups: [
      { titleKey: 'dashboard.navGroup.money', hrefs: [`${E}/wallet`, `${E}/orders`, `${E}/membership`, `${E}/perks`] },
      { titleKey: 'dashboard.navGroup.work', hrefs: [`${E}/venture`, `${E}/cofounder`, `${E}/startup`, `${E}/marketplace`, `${E}/bookings`, `${E}/consultations`] },
      { titleKey: 'dashboard.navGroup.compliance', hrefs: [`${E}/taxes`, `${E}/network-pass`] },
      { titleKey: 'dashboard.navGroup.account', hrefs: [`${E}/settings`] },
    ],
  },
};

/** Resolve a premium shell's tabs and grouped sheet against the role's nav. */
export function getPremiumNav(role: UserRole): { tabs: NavItem[]; groups: { titleKey: string; items: NavItem[] }[] } | null {
  const cfg = premiumNavByRole[role];
  if (!cfg) return null;
  const all = dashboardNavByRole[role].filter((i) => !i.sectionHeader);
  const byHref = (h: string) => all.find((i) => i.href === h);
  const tabs = cfg.tabs.map(byHref).filter((i): i is NavItem => Boolean(i));
  if (tabs.length !== 4) return null;
  // "Overview" wraps in a fifth of a phone; the bar says Home.
  tabs[0] = { ...tabs[0]!, labelKey: 'dashboard.navGroup.home' };
  const used = new Set(cfg.tabs);
  const groups = cfg.groups.map((g) => {
    const items = g.hrefs.map(byHref).filter((i): i is NavItem => Boolean(i));
    items.forEach((i) => used.add(i.href));
    return { titleKey: g.titleKey, items };
  });
  const rest = all.filter((i) => !used.has(i.href));
  if (rest.length) groups[groups.length - 1]!.items.push(...rest);
  return { tabs, groups: groups.filter((g) => g.items.length > 0) };
}

/** Sentinel used by the bottom bar / sheet for the "More" affordance. */
export const MORE_NAV: NavItem = {
  labelKey: 'dashboard.more',
  href: '#more',
  icon: MoreHorizontal,
};

/**
 * Resolve the curated primary tabs (in declared order) for a role, looking up
 * the label/icon from `dashboardNavByRole` so config stays single-sourced.
 * Falls back to the first four nav items if a curated href is ever missing.
 */
export function getMobilePrimaryTabs(role: UserRole): NavItem[] {
  const all = dashboardNavByRole[role].filter((i) => !i.sectionHeader);
  const wanted = primaryTabHrefsByRole[role] ?? [];
  const resolved = wanted
    .map((href) => all.find((i) => i.href === href))
    .filter((i): i is NavItem => Boolean(i));
  return resolved.length > 0 ? resolved : all.slice(0, 4);
}

/**
 * Destinations shown in the "More" bottom sheet — every non-primary, non-header
 * nav item for the role (so nothing is ever unreachable from mobile).
 */
export function getMobileMoreItems(role: UserRole): NavItem[] {
  const primary = new Set(getMobilePrimaryTabs(role).map((i) => i.href));
  return dashboardNavByRole[role].filter((i) => !i.sectionHeader && !primary.has(i.href));
}

/**
 * Per-role "quick action" pills shown under the mobile overview greeting.
 * Each is a one-tap deep link into an existing destination — `labelKey` reuses
 * an existing `dashboard.*` translation key, so no new strings are introduced.
 */
export interface MobileQuickAction {
  labelKey: string;
  href: string;
  icon: LucideIcon;
}

export const mobileQuickActionsByRole: Record<UserRole, MobileQuickAction[]> = {
  ENTREPRENEUR: [
    { labelKey: 'dashboard.bookSpace',    href: '/spaces',                              icon: MapPin },
    { labelKey: 'dashboard.wallet',       href: '/dashboard/entrepreneur/wallet',       icon: Wallet },
    { labelKey: 'dashboard.marketplace',  href: '/dashboard/entrepreneur/marketplace',  icon: TrendingUp },
    { labelKey: 'dashboard.startup',      href: '/dashboard/entrepreneur/startup',      icon: Rocket },
  ],
  INVESTOR: [
    { labelKey: 'dashboard.startups',     href: '/dashboard/investor/startups',         icon: Rocket },
    { labelKey: 'dashboard.saved',        href: '/dashboard/investor/saved',            icon: Star },
    { labelKey: 'dashboard.meetings',     href: '/dashboard/investor/meetings',         icon: Calendar },
  ],
  INCUBATOR: [
    { labelKey: 'dashboard.spaces',       href: '/dashboard/incubator/spaces',          icon: Building2 },
    { labelKey: 'dashboard.programs',     href: '/dashboard/incubator/programs',        icon: Briefcase },
    { labelKey: 'dashboard.bookings',     href: '/dashboard/incubator/bookings',        icon: Calendar },
    { labelKey: 'dashboard.clients',      href: '/dashboard/incubator/clients',         icon: UsersRound },
  ],
  FREELANCER: [
    { labelKey: 'dashboard.invoices',     href: '/dashboard/freelancer/invoices/new',   icon: Briefcase },
    { labelKey: 'dashboard.paymentLinks', href: '/dashboard/freelancer/payment-links',  icon: Wallet },
    { labelKey: 'dashboard.clients',      href: '/dashboard/freelancer/clients',        icon: UsersRound },
  ],
  ADMIN: [
    { labelKey: 'dashboard.users',        href: '/dashboard/admin/users',               icon: Users },
    { labelKey: 'dashboard.bookings',     href: '/dashboard/admin/bookings',            icon: Calendar },
    { labelKey: 'dashboard.payments',     href: '/dashboard/admin/payments',            icon: ArrowUpCircle },
    { labelKey: 'dashboard.analytics',    href: '/dashboard/admin/analytics',           icon: BarChart2 },
  ],
};
