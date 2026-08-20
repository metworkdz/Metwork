import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Inbox" subtitle="Leads entrants et éléments à traiter." />
      <ComingSoon title="Inbox" icon={Inbox} prompt={2} />
    </>
  );
}
