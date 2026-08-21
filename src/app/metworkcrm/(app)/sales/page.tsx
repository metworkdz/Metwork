import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { OpportunitiesList } from '@/components/metworkcrm/opportunities/opportunities-list';

export const metadata: Metadata = { title: 'Ventes' };
export const dynamic = 'force-dynamic';

export default async function CrmSalesPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Ventes" subtitle="Pipeline commercial et opportunités." />
      <OpportunitiesList />
    </>
  );
}
