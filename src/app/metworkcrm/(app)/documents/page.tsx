import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Documents" subtitle="Conventions, contrats, propositions et supports." />
      <ComingSoon title="Documents" icon={FileText} prompt={5} />
    </>
  );
}
