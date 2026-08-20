import type { Metadata } from 'next';
import { CalendarRange } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Programmes' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Programmes" subtitle="Programmes, formations et événements." />
      <ComingSoon title="Programmes" icon={CalendarRange} prompt={4} />
    </>
  );
}
