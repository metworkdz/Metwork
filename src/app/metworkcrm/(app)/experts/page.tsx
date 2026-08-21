import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ExpertsList } from '@/components/metworkcrm/experts/experts-list';

export const metadata: Metadata = { title: 'Experts' };
export const dynamic = 'force-dynamic';

export default async function CrmExpertsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Experts" subtitle="Réseau d’experts et de formateurs." />
      <ExpertsList />
    </>
  );
}
