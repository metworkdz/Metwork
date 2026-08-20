import type { Metadata } from 'next';
import { Banknote } from 'lucide-react';
import { requireCrmAdmin } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Paiements' };
export const dynamic = 'force-dynamic';

/**
 * ADMIN-only (dev rules R-19). `requireCrmAdmin()` is the real gate — the
 * sidebar merely hides the link, which is not a guard.
 */
export default async function CrmPage() {
  await requireCrmAdmin();
  return (
    <>
      <CrmPageHeader title="Paiements" subtitle="Suivi opérationnel des encaissements." />
      <ComingSoon title="Paiements" icon={Banknote} prompt={5} />
    </>
  );
}
