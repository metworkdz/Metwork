import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { OiProjectsList } from '@/components/metworkcrm/oi-projects/oi-projects-list';

export const metadata: Metadata = { title: 'Open Innovation' };
export const dynamic = 'force-dynamic';

export default async function CrmOpenInnovationPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Open Innovation" subtitle="Défis, POC et projets d’innovation ouverte." />
      <OiProjectsList />
    </>
  );
}
