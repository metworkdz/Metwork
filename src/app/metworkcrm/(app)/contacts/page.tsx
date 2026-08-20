import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Contacts' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Contacts" subtitle="Personnes rattachées aux organisations." />
      <ComingSoon title="Contacts" icon={Users} prompt={2} />
    </>
  );
}
