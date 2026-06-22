import type { UserRole } from '@/types/auth';

const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  ADMIN: '/dashboard/admin',
  ENTREPRENEUR: '/dashboard/entrepreneur',
  INVESTOR: '/dashboard/investor',
  INCUBATOR: '/dashboard/incubator',
  BUSINESS: '/dashboard/business',
};

/** Resolve the role-specific dashboard landing path. */
export function dashboardPathForRole(role: UserRole): string {
  return DASHBOARD_BY_ROLE[role] ?? '/dashboard/entrepreneur';
}
