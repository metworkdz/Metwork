import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { SpaceBookingsList } from '@/components/metworkcrm/space-bookings/space-bookings-list';

export const metadata: Metadata = { title: 'Espaces' };
export const dynamic = 'force-dynamic';

export default async function CrmSpacesPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Espaces" subtitle="Suivi interne des réservations d’espaces." />
      <SpaceBookingsList />
    </>
  );
}
