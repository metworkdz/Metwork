import type { Metadata } from 'next';
import { Lightbulb } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Open Innovation' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Open Innovation" subtitle="Défis, POC et projets d’innovation ouverte." />
      <ComingSoon title="Open Innovation" icon={Lightbulb} prompt={4} />
    </>
  );
}
