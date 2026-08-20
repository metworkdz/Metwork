import type { Metadata } from 'next';
import { UserCog } from 'lucide-react';
import { requireCrmAdmin } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Utilisateurs' };
export const dynamic = 'force-dynamic';

/**
 * ADMIN-only (dev rules R-19). `requireCrmAdmin()` is the real gate — the
 * sidebar merely hides the link, which is not a guard.
 */
export default async function CrmPage() {
  await requireCrmAdmin();
  return (
    <>
      <CrmPageHeader title="Utilisateurs" subtitle="Comptes de l’équipe interne." />
      <ComingSoon title="Utilisateurs" icon={UserCog} prompt={8} />
    </>
  );
}
