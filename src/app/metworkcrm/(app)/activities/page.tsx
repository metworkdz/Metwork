import type { Metadata } from 'next';
import { ListChecks } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Activités' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Activités" subtitle="Historique des interactions : appels, e-mails, réunions." />
      <ComingSoon title="Activités" icon={ListChecks} prompt={2} />
    </>
  );
}
