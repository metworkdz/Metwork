import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmSidebar } from '@/components/metworkcrm/nav/sidebar';

/**
 * Guarded CRM shell.
 *
 * `requireCrmUser()` here is the single choke point for the whole authenticated
 * tree: it redirects to /metworkcrm/login when there is no session, and to
 * /metworkcrm/change-password while `mustChangePassword` is set. Admin-only
 * pages additionally call `requireCrmAdmin()` themselves — a layout guard alone
 * cannot express per-page roles.
 */
export const dynamic = 'force-dynamic';

export default async function CrmAppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCrmUser();

  return (
    <div className="min-h-screen bg-[var(--crm-canvas)]">
      <CrmSidebar role={user.role} userName={user.name} userEmail={user.email} />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
