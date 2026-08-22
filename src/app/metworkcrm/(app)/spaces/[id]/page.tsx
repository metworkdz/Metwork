import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getSpaceBookingDetail } from '@/server/metworkcrm/services/space-bookings';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { SpaceBookingDetail } from '@/components/metworkcrm/space-bookings/space-booking-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { booking } = await getSpaceBookingDetail(id, { role: 'ADMIN' });
    return { title: booking.reference };
  } catch {
    return { title: 'Réservation' };
  }
}

export default async function CrmSpaceBookingDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getSpaceBookingDetail(id, user);
    return <SpaceBookingDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
