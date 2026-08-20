import type { Metadata } from 'next';
import { Gauge } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Rapports' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Rapports" subtitle="Indicateurs et exports." />
      <ComingSoon title="Rapports" icon={Gauge} prompt={6} />
    </>
  );
}
