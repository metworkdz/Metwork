import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { PartnershipsList } from '@/components/metworkcrm/partnerships/partnerships-list';

export const metadata: Metadata = { title: 'Partenariats' };
export const dynamic = 'force-dynamic';

export default async function CrmPartnershipsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Partenariats" subtitle="Partenaires corporate, académiques et institutionnels." />
      <PartnershipsList />
    </>
  );
}
