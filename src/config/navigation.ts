import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  Building2,
  Briefcase,
  GraduationCap,
  TrendingUp,
  LayoutDashboard,
  LayoutTemplate,
  Wallet,
  Settings,
  Users,
  Rocket,
  FileText,
  CreditCard,
  Star,
  Calendar as CalendarIcon,
} from 'lucide-react';
import type { UserRole } from '@/types/auth';

export interface NavItem {
  /** Translation key for the label, resolved via next-intl */
  labelKey: string;
  href: string;
  icon?: LucideIcon;
  /** When true, link opens in new tab and is treated as external */
  external?: boolean;
  /** When true, this item is not a route — it's a section header (used in dashboards) */
  sectionHeader?: boolean;
  /** Roles allowed to see this item (omit = visible to all) */
  roles?: UserRole[];
}

/**
 * Public navbar items — visible on all marketing pages.
 * Order matches what's shown to the user.
 */
export const publicNavItems: readonly NavItem[] = [
  { labelKey: 'nav.programs', href: '/programs', icon: Briefcase },
  { labelKey: 'nav.events', href: '/events', icon: Calendar },
  { labelKey: 'nav.spaces', href: '/spaces', icon: Building2 },
  { labelKey: 'nav.mentors', href: '/mentors', icon: Star },
  { labelKey: 'nav.investors', href: '/investors', icon: TrendingUp },
  {
    labelKey: 'nav.academy',
    href: '/academy',
    icon: GraduationCap,
    external: true,
  },
] as const;

/**
 * Footer link groups.
 */
export const footerNavGroups = [
  {
    titleKey: 'footer.platform',
    links: [
      { labelKey: 'nav.programs', href: '/programs' },
      { labelKey: 'nav.events', href: '/events' },
      { labelKey: 'nav.spaces', href: '/spaces' },
      { labelKey: 'nav.investors', href: '/investors' },
    ],
  },
  {
    titleKey: 'footer.company',
    links: [
      { labelKey: 'footer.about', href: '/about' },
      { labelKey: 'footer.careers', href: '/careers' },
      { labelKey: 'footer.contact', href: '/contact' },
      { labelKey: 'nav.academy', href: '/academy', external: true },
    ],
  },
  {
    titleKey: 'footer.legal',
    links: [
      { labelKey: 'footer.privacy', href: '/privacy-policy' },
      { labelKey: 'footer.terms', href: '/terms' },
      { labelKey: 'footer.cookies', href: '/cookies' },
    ],
  },
] as const;

/**
 * Dashboard nav items per role.
 * Used by the role-aware dashboard sidebar.
 */
export const dashboardNavByRole: Record<UserRole, NavItem[]> = {
  ENTREPRENEUR: [
    { labelKey: 'dashboard.overview', href: '/dashboard/entrepreneur', icon: LayoutDashboard },
    { labelKey: 'dashboard.bookings', href: '/dashboard/entrepreneur/bookings', icon: CalendarIcon },
    { labelKey: 'dashboard.startup', href: '/dashboard/entrepreneur/startup', icon: Rocket },
    { labelKey: 'dashboard.marketplace', href: '/dashboard/entrepreneur/marketplace', icon: TrendingUp },
    { labelKey: 'dashboard.wallet', href: '/dashboard/entrepreneur/wallet', icon: Wallet },
    { labelKey: 'dashboard.membership', href: '/dashboard/entrepreneur/membership', icon: CreditCard },
    { labelKey: 'dashboard.settings', href: '/dashboard/entrepreneur/settings', icon: Settings },
  ],
  INVESTOR: [
    { labelKey: 'dashboard.overview', href: '/dashboard/investor', icon: LayoutDashboard },
    { labelKey: 'dashboard.startups', href: '/dashboard/investor/startups', icon: Rocket },
    { labelKey: 'dashboard.meetings', href: '/dashboard/investor/meetings', icon: CalendarIcon },
    { labelKey: 'dashboard.portfolio', href: '/dashboard/investor/portfolio', icon: TrendingUp },
    { labelKey: 'dashboard.settings', href: '/dashboard/investor/settings', icon: Settings },
  ],
  INCUBATOR: [
    { labelKey: 'dashboard.overview', href: '/dashboard/incubator', icon: LayoutDashboard },
    { labelKey: 'dashboard.spaces', href: '/dashboard/incubator/spaces', icon: Building2 },
    { labelKey: 'dashboard.programs', href: '/dashboard/incubator/programs', icon: Briefcase },
    { labelKey: 'dashboard.events', href: '/dashboard/incubator/events', icon: Calendar },
    { labelKey: 'dashboard.bookings', href: '/dashboard/incubator/bookings', icon: CalendarIcon },
    { labelKey: 'dashboard.revenue', href: '/dashboard/incubator/revenue', icon: TrendingUp },
    { labelKey: 'dashboard.invoices', href: '/dashboard/incubator/invoices', icon: FileText },
    { labelKey: 'dashboard.wallet', href: '/dashboard/incubator/wallet', icon: Wallet },
    { labelKey: 'dashboard.settings', href: '/dashboard/incubator/settings', icon: Settings },
  ],
  ADMIN: [
    { labelKey: 'dashboard.overview', href: '/dashboard/admin', icon: LayoutDashboard },
    { labelKey: 'dashboard.users', href: '/dashboard/admin/users', icon: Users },
    { labelKey: 'dashboard.incubators', href: '/dashboard/admin/incubators', icon: Building2 },
    { labelKey: 'dashboard.memberships', href: '/dashboard/admin/memberships', icon: CreditCard },
    { labelKey: 'dashboard.commissions', href: '/dashboard/admin/commissions', icon: TrendingUp },
    { labelKey: 'dashboard.content', href: '/dashboard/admin/cms', icon: LayoutTemplate },
    { labelKey: 'dashboard.consultations', href: '/dashboard/admin/mentor-bookings', icon: CalendarIcon },
    { labelKey: 'dashboard.settings', href: '/dashboard/admin/settings', icon: Settings },
  ],
};
