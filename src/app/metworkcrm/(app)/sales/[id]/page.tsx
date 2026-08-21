import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getOpportunityDetail } from '@/server/metworkcrm/services/opportunities';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { OpportunityDetail } from '@/components/metworkcrm/opportunities/opportunity-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { opportunity } = await getOpportunityDetail(id, { role: 'ADMIN' });
    return { title: opportunity.title };
  } catch {
    return { title: 'Opportunité' };
  }
}

export default async function CrmOpportunityDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getOpportunityDetail(id, user);
    return <OpportunityDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
