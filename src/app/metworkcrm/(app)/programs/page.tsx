import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ProgramsList } from '@/components/metworkcrm/programs/programs-list';

export const metadata: Metadata = { title: 'Programmes' };
export const dynamic = 'force-dynamic';

export default async function CrmProgramsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Programmes" subtitle="Programmes, formations et événements." />
      <ProgramsList />
    </>
  );
}
