import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { OrganizationsList } from '@/components/metworkcrm/organizations/organizations-list';

export const metadata: Metadata = { title: 'Organisations' };
export const dynamic = 'force-dynamic';

export default async function CrmOrganizationsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Organisations" subtitle="Entreprises, incubateurs, universités et institutions." />
      <OrganizationsList />
    </>
  );
}
