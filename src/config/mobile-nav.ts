import { MoreHorizontal } from 'lucide-react';
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
    '/dashboard/entrepreneur/marketplace',
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
  TRAINER: [
    '/dashboard/trainer',
    '/dashboard/trainer/programs',
    '/dashboard/trainer/bookings',
    '/dashboard/trainer/wallet',
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
