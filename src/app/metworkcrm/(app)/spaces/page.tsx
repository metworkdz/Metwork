import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Espaces' };
export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Espaces" subtitle="Suivi interne des réservations d’espaces." />
      <ComingSoon title="Espaces" icon={MapPin} prompt={5} />
    </>
  );
}
