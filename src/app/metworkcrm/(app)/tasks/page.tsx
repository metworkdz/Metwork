import type { Metadata } from 'next';
import { Target } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Tâches' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Tâches" subtitle="Suivi des actions à mener." />
      <ComingSoon title="Tâches" icon={Target} prompt={2} />
    </>
  );
}
