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
    '/dashboard/entrepreneur/wallet',
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
  BUSINESS: [
    '/dashboard/business',
    '/dashboard/business/programs',
    '/dashboard/business/bookings',
    '/dashboard/business/wallet',
  ],
  ADMIN: [
    '/dashboard/admin',
    '/dashboard/admin/users',
    '/dashboard/admin/bookings',
    '/dashboard/admin/analytics',
  ],
};

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
  BUSINESS: [
    { labelKey: 'dashboard.programs',     href: '/dashboard/business/programs',         icon: Briefcase },
    { labelKey: 'dashboard.events',       href: '/dashboard/business/events',           icon: Calendar },
    { labelKey: 'dashboard.bookings',     href: '/dashboard/business/bookings',         icon: Calendar },
    { labelKey: 'dashboard.wallet',       href: '/dashboard/business/wallet',           icon: Wallet },
  ],
  ADMIN: [
    { labelKey: 'dashboard.users',        href: '/dashboard/admin/users',               icon: Users },
    { labelKey: 'dashboard.bookings',     href: '/dashboard/admin/bookings',            icon: Calendar },
    { labelKey: 'dashboard.payments',     href: '/dashboard/admin/payments',            icon: ArrowUpCircle },
    { labelKey: 'dashboard.analytics',    href: '/dashboard/admin/analytics',           icon: BarChart2 },
  ],
};
