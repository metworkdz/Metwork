import type { Metadata } from 'next';
import { Rocket } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Startups' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Startups" subtitle="Suivi des startups accompagnées." />
      <ComingSoon title="Startups" icon={Rocket} prompt={3} />
    </>
  );
}
