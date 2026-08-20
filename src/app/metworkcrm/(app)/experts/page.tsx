import type { Metadata } from 'next';
import { UsersRound } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Experts' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Experts" subtitle="Réseau d’experts et de formateurs." />
      <ComingSoon title="Experts" icon={UsersRound} prompt={3} />
    </>
  );
}
