import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import type { UserRole } from '@/types/auth';

/**
 * Server-side role guard. Use at the top of any dashboard page
 * that should be restricted to specific roles.
 *
 * Returns the session user if authorized, or redirects.
 *
 * Example:
 *   export default async function Page() {
 *     const user = await requireRole(['ENTREPRENEUR']);
 *     return <Dashboard user={user} />;
 *   }
 */
export async function requireRole(allowedRoles: UserRole[]) {
  const user = await getServerSession();
  if (!user) redirect('/login');
  if (!allowedRoles.includes(user.role)) {
    // Redirect to user's own dashboard
    redirect(`/dashboard/${user.role.toLowerCase()}`);
  }
  return user;
}
