import type { Metadata } from 'next';
import { Building2 } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Organisations' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Organisations" subtitle="Entreprises, incubateurs, universités et institutions." />
      <ComingSoon title="Organisations" icon={Building2} prompt={2} />
    </>
  );
}
