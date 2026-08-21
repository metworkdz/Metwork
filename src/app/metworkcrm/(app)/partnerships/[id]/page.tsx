import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getPartnershipDetail } from '@/server/metworkcrm/services/partnerships';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { PartnershipDetail } from '@/components/metworkcrm/partnerships/partnership-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { partnership } = await getPartnershipDetail(id, { role: 'ADMIN' });
    return { title: partnership.name };
  } catch {
    return { title: 'Partenariat' };
  }
}

export default async function CrmPartnershipDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getPartnershipDetail(id, user);
    return <PartnershipDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
