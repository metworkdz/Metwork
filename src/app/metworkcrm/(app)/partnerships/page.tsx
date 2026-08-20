import type { Metadata } from 'next';
import { Handshake } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Partenariats' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Partenariats" subtitle="Partenaires corporate, académiques et institutionnels." />
      <ComingSoon title="Partenariats" icon={Handshake} prompt={3} />
    </>
  );
}
