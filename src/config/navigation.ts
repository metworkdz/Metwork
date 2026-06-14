import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  Building2,
  Briefcase,
  GraduationCap,
  TrendingUp,
  Tag,
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
  UsersRound,
  Layers,
  ArrowDownCircle,
  BarChart2,
  ArrowUpCircle,
  UserCheck,
  Gift,
  MessageSquare,
  ShieldAlert,
  Network,
  IdCard,
  MapPin,
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
 * Public navbar item — either a direct link (has `href`) or a dropdown
 * trigger (has `children`). The desktop navbar renders `children` as a
 * dropdown menu; the mobile drawer renders them as a labelled group.
 */
export interface PublicNavItem {
  labelKey: string;
  href?: string;
  icon?: LucideIcon;
  external?: boolean;
  children?: readonly NavItem[];
}

/**
 * Public navbar items — visible on all marketing pages.
 * Order matches what's shown to the user.
 */
export const publicNavItems: readonly PublicNavItem[] = [
  {
    labelKey: 'nav.forEntrepreneurs',
    children: [
      { labelKey: 'nav.programs', href: '/programs', icon: Briefcase },
      { labelKey: 'nav.events', href: '/events', icon: Calendar },
      { labelKey: 'nav.spaces', href: '/spaces', icon: Building2 },
      { labelKey: 'nav.mentors', href: '/mentors', icon: Star },
      { labelKey: 'nav.academy', href: '/academy', icon: GraduationCap },
    ],
  },
  { labelKey: 'nav.forIncubators', href: '/incubators', icon: Building2 },
  { labelKey: 'nav.forInvestors', href: '/investors', icon: TrendingUp },
  { labelKey: 'nav.memberships', href: '/pricing', icon: Tag },
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
      { labelKey: 'nav.memberships', href: '/pricing' },
    ],
  },
  {
    titleKey: 'footer.company',
    links: [
      { labelKey: 'footer.about', href: '/about' },
      { labelKey: 'footer.contact', href: '/contact' },
      { labelKey: 'nav.academy', href: '/academy' },
    ],
  },
  {
    titleKey: 'footer.legal',
    links: [
      { labelKey: 'footer.privacy', href: '/privacy-policy' },
      { labelKey: 'footer.terms', href: '/terms' },
    ],
  },
] as const;

/**
 * Dashboard nav items per role.
 * Used by the role-aware dashboard sidebar.
 */
export const dashboardNavByRole: Record<UserRole, NavItem[]> = {
  ENTREPRENEUR: [
    { labelKey: 'dashboard.overview',       href: '/dashboard/entrepreneur',                icon: LayoutDashboard },
    { labelKey: 'dashboard.bookings',       href: '/dashboard/entrepreneur/bookings',       icon: CalendarIcon    },
    { labelKey: 'dashboard.startup',        href: '/dashboard/entrepreneur/startup',        icon: Rocket          },
    { labelKey: 'dashboard.marketplace',    href: '/dashboard/entrepreneur/marketplace',    icon: TrendingUp      },
    { labelKey: 'dashboard.consultations',  href: '/dashboard/entrepreneur/consultations',  icon: UserCheck       },
    { labelKey: 'dashboard.perks',          href: '/dashboard/entrepreneur/perks',          icon: Gift            },
    { labelKey: 'dashboard.wallet',         href: '/dashboard/entrepreneur/wallet',         icon: Wallet          },
    { labelKey: 'dashboard.membership',     href: '/dashboard/entrepreneur/membership',     icon: CreditCard      },
    { labelKey: 'dashboard.networkPass',    href: '/dashboard/entrepreneur/network-pass',   icon: IdCard          },
    { labelKey: 'dashboard.settings',       href: '/dashboard/entrepreneur/settings',       icon: Settings        },
  ],
  INVESTOR: [
    { labelKey: 'dashboard.overview',  href: '/dashboard/investor',            icon: LayoutDashboard },
    { labelKey: 'dashboard.startups',  href: '/dashboard/investor/startups',   icon: Rocket          },
    { labelKey: 'dashboard.saved',     href: '/dashboard/investor/saved',      icon: Star            },
    { labelKey: 'dashboard.meetings',  href: '/dashboard/investor/meetings',   icon: CalendarIcon    },
    { labelKey: 'dashboard.portfolio', href: '/dashboard/investor/portfolio',  icon: TrendingUp      },
    { labelKey: 'dashboard.settings',  href: '/dashboard/investor/settings',   icon: Settings        },
  ],
  INCUBATOR: [
    { labelKey: 'dashboard.overview',  href: '/dashboard/incubator',              icon: LayoutDashboard },
    { labelKey: 'dashboard.analytics', href: '/dashboard/incubator/analytics',    icon: BarChart2 },
    { labelKey: 'dashboard.clients',   href: '/dashboard/incubator/clients',      icon: UsersRound },
    { labelKey: 'dashboard.income',    href: '/dashboard/incubator/income',       icon: ArrowUpCircle },
    { labelKey: 'dashboard.expenses',  href: '/dashboard/incubator/expenses',     icon: ArrowDownCircle },
    { labelKey: 'dashboard.services',  href: '/dashboard/incubator/services',     icon: Layers },
    { labelKey: 'dashboard.spaces',    href: '/dashboard/incubator/spaces',       icon: Building2 },
    { labelKey: 'dashboard.programs',  href: '/dashboard/incubator/programs',     icon: Briefcase },
    { labelKey: 'dashboard.events',    href: '/dashboard/incubator/events',       icon: Calendar },
    { labelKey: 'dashboard.bookings',  href: '/dashboard/incubator/bookings',     icon: CalendarIcon },
    { labelKey: 'dashboard.revenue',   href: '/dashboard/incubator/revenue',      icon: TrendingUp },
    { labelKey: 'dashboard.invoices',  href: '/dashboard/incubator/invoices',     icon: FileText },
    { labelKey: 'dashboard.wallet',    href: '/dashboard/incubator/wallet',       icon: Wallet },
    { labelKey: 'dashboard.settings',  href: '/dashboard/incubator/settings',     icon: Settings },
  ],
  TRAINER: [
    { labelKey: 'dashboard.overview',    href: '/dashboard/trainer',             icon: LayoutDashboard },
    { labelKey: 'dashboard.programs',    href: '/dashboard/trainer/programs',    icon: Briefcase       },
    { labelKey: 'dashboard.events',      href: '/dashboard/trainer/events',      icon: Calendar        },
    { labelKey: 'dashboard.bookings',    href: '/dashboard/trainer/bookings',    icon: CalendarIcon    },
    { labelKey: 'dashboard.bookSpace',   href: '/spaces',                        icon: MapPin          },
    { labelKey: 'dashboard.wallet',      href: '/dashboard/trainer/wallet',      icon: Wallet          },
    { labelKey: 'dashboard.withdrawals', href: '/dashboard/trainer/withdrawals', icon: ArrowUpCircle   },
    { labelKey: 'dashboard.settings',    href: '/dashboard/trainer/settings',    icon: Settings        },
  ],
  ADMIN: [
    // ── Platform management ──────────────────────────────────────────────────
    { labelKey: 'dashboard.overview',      href: '/dashboard/admin',                 icon: LayoutDashboard },
    { labelKey: 'dashboard.analytics',     href: '/dashboard/admin/analytics',       icon: BarChart2       },
    { labelKey: 'dashboard.users',         href: '/dashboard/admin/users',           icon: Users },
    { labelKey: 'dashboard.incubators',    href: '/dashboard/admin/incubators',      icon: Building2 },
    { labelKey: 'dashboard.memberships',      href: '/dashboard/admin/memberships',          icon: CreditCard },
    { labelKey: 'dashboard.promoCodes',       href: '/dashboard/admin/promo-codes',          icon: Tag        },
    { labelKey: 'dashboard.partnerNetwork',   href: '/dashboard/admin/partners',             icon: Network    },
    { labelKey: 'dashboard.partnerPromoCodes',href: '/dashboard/admin/partner-promo-codes',  icon: Tag        },
    { labelKey: 'dashboard.commissions',   href: '/dashboard/admin/commissions',     icon: TrendingUp },
    { labelKey: 'dashboard.bookings',      href: '/dashboard/admin/bookings',        icon: CalendarIcon },
    { labelKey: 'dashboard.mentors',       href: '/dashboard/admin/mentors',         icon: Star },
    { labelKey: 'dashboard.consultations', href: '/dashboard/admin/mentor-bookings', icon: CalendarIcon },
    { labelKey: 'dashboard.mentorRevenue', href: '/dashboard/admin/mentor-revenue',  icon: TrendingUp },
    { labelKey: 'dashboard.contacts',         href: '/dashboard/admin/contacts',          icon: MessageSquare },
    { labelKey: 'dashboard.investorContacts', href: '/dashboard/admin/investor-contacts', icon: TrendingUp    },
    { labelKey: 'dashboard.withdrawals',      href: '/dashboard/admin/withdrawals',       icon: Wallet        },
    { labelKey: 'dashboard.content',          href: '/dashboard/admin/cms',               icon: LayoutTemplate },
    { labelKey: 'dashboard.auditLog',         href: '/dashboard/admin/audit-log',         icon: ShieldAlert    },
    { labelKey: 'dashboard.settings',      href: '/dashboard/admin/settings',        icon: Settings },
  ],
};
