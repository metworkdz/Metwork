import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmShell } from '@/components/metworkcrm/shell/crm-shell';

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
    <CrmShell role={user.role} userName={user.name} userEmail={user.email}>
      {children}
    </CrmShell>
  );
}
