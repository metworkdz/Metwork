/**
 * /dashboard — role-based redirect.
 *
 * The middleware sends authenticated users here when it can't determine
 * the role (Edge runtime has no session-decode capability).  We read the
 * session server-side and redirect to the correct sub-dashboard.
 */
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import type { UserRole } from '@/types/auth';

const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  ADMIN: '/dashboard/admin',
  ENTREPRENEUR: '/dashboard/entrepreneur',
  INVESTOR: '/dashboard/investor',
  INCUBATOR: '/dashboard/incubator',
};

export default async function DashboardIndexPage() {
  const user = await getServerSession();
  if (!user) redirect('/login');
  redirect(DASHBOARD_BY_ROLE[user.role] ?? '/dashboard/entrepreneur');
}
