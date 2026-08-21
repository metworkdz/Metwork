/**
 * METWORK OS CRM — navigation model.
 *
 * SINGLE SOURCE OF TRUTH for both the sidebar and the route guards. Keeping
 * them in one place means the UI and the authorization cannot drift apart:
 * `adminOnly` here is what hides the link, and the page's own
 * `requireCrmAdmin()` enforces it server-side (dev rules R-19 — a UI-only
 * guard is not a guard).
 *
 * `status: 'coming-soon'` items still render a real page with an empty state;
 * nothing in the nav is allowed to 404 (Prompt 1 brief).
 */
import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Building2,
  CalendarRange,
  FileText,
  FolderKanban,
  Gauge,
  Handshake,
  Inbox,
  Lightbulb,
  ListChecks,
  MapPin,
  Rocket,
  Settings,
  Target,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react';

export type CrmNavStatus = 'ready' | 'coming-soon';

export interface CrmNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  status: CrmNavStatus;
  adminOnly?: boolean;
  /** Which later prompt delivers this module — surfaced in the empty state. */
  prompt?: number;
}

export interface CrmNavSection {
  title: string | null;
  items: CrmNavItem[];
}

export const CRM_NAV: CrmNavSection[] = [
  {
    title: null,
    items: [
      { label: 'Tableau de bord', href: '/metworkcrm', icon: Gauge, status: 'ready' },
      // Reads contactSubmissions from the platform's JSON store — the first
      // cross-store read (platform-refs.ts) isn't built until Prompt 3.
      // Mislabeled `prompt: 2` in Prompt 1; corrected here.
      { label: 'Inbox', href: '/metworkcrm/inbox', icon: Inbox, status: 'coming-soon', prompt: 3 },
    ],
  },
  {
    title: 'CRM',
    items: [
      { label: 'Organisations', href: '/metworkcrm/organizations', icon: Building2, status: 'coming-soon', prompt: 2 },
      { label: 'Contacts', href: '/metworkcrm/contacts', icon: Users, status: 'coming-soon', prompt: 2 },
      { label: 'Activités', href: '/metworkcrm/activities', icon: ListChecks, status: 'coming-soon', prompt: 2 },
      { label: 'Tâches', href: '/metworkcrm/tasks', icon: Target, status: 'coming-soon', prompt: 2 },
    ],
  },
  {
    title: 'Écosystème',
    items: [
      { label: 'Ventes', href: '/metworkcrm/sales', icon: FolderKanban, status: 'ready' },
      { label: 'Startups', href: '/metworkcrm/startups', icon: Rocket, status: 'ready' },
      { label: 'Experts', href: '/metworkcrm/experts', icon: UsersRound, status: 'ready' },
      { label: 'Partenariats', href: '/metworkcrm/partnerships', icon: Handshake, status: 'ready' },
      { label: 'Open Innovation', href: '/metworkcrm/open-innovation', icon: Lightbulb, status: 'ready' },
      { label: 'Programmes', href: '/metworkcrm/programs', icon: CalendarRange, status: 'ready' },
      { label: 'Espaces', href: '/metworkcrm/spaces', icon: MapPin, status: 'ready' },
    ],
  },
  {
    title: 'Gestion',
    items: [
      { label: 'Paiements', href: '/metworkcrm/payments', icon: Banknote, status: 'ready', adminOnly: true },
      { label: 'Documents', href: '/metworkcrm/documents', icon: FileText, status: 'ready' },
      { label: 'Rapports', href: '/metworkcrm/reports', icon: Gauge, status: 'coming-soon', prompt: 6 },
      { label: 'Utilisateurs', href: '/metworkcrm/users', icon: UserCog, status: 'coming-soon', prompt: 8, adminOnly: true },
      { label: 'Paramètres', href: '/metworkcrm/settings', icon: Settings, status: 'coming-soon', prompt: 8, adminOnly: true },
    ],
  },
];

/** Nav filtered for a role — the sidebar never shows a link the user cannot open. */
export function navForRole(role: 'ADMIN' | 'TEAM_MEMBER'): CrmNavSection[] {
  if (role === 'ADMIN') return CRM_NAV;
  return CRM_NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.adminOnly),
  })).filter((section) => section.items.length > 0);
}
