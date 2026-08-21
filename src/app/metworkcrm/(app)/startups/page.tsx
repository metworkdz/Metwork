import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { StartupsList } from '@/components/metworkcrm/startups/startups-list';

export const metadata: Metadata = { title: 'Startups' };
export const dynamic = 'force-dynamic';

export default async function CrmStartupsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Startups" subtitle="Suivi des startups accompagnées." />
      <StartupsList />
    </>
  );
}
