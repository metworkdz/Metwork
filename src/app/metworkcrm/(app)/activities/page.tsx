import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { InteractionsList } from '@/components/metworkcrm/interactions/interactions-list';

export const metadata: Metadata = { title: 'Activités' };
export const dynamic = 'force-dynamic';

export default async function CrmActivitiesPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Activités" subtitle="Historique des interactions : appels, e-mails, réunions." />
      <InteractionsList />
    </>
  );
}
