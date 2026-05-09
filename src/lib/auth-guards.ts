import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getServerSession } from '@/lib/session';
import type { UserRole } from '@/types/auth';

/**
 * Server-side role guard. Use at the top of any dashboard page
 * that should be restricted to specific roles.
 *
 * Returns the session user if authorized, or redirects with the
 * correct locale prefix (e.g. /en/login, /fr/dashboard/incubator).
 *
 * Example:
 *   export default async function Page() {
 *     const user = await requireRole(['ENTREPRENEUR']);
 *     return <Dashboard user={user} />;
 *   }
 */
export async function requireRole(allowedRoles: UserRole[]) {
  const [user, locale] = await Promise.all([getServerSession(), getLocale()]);
  if (!user) redirect(`/${locale}/login`);
  if (!allowedRoles.includes(user.role)) {
    // Redirect to the user's own role dashboard with locale prefix
    redirect(`/${locale}/dashboard/${user.role.toLowerCase()}`);
  }
  return user!;
}
