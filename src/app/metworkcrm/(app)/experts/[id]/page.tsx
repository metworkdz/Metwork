import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getExpertDetail } from '@/server/metworkcrm/services/experts';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { ExpertDetail } from '@/components/metworkcrm/experts/expert-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { expert } = await getExpertDetail(id, { role: 'ADMIN' });
    return { title: expert.displayNameCache ?? expert.name ?? 'Expert' };
  } catch {
    return { title: 'Expert' };
  }
}

export default async function CrmExpertDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getExpertDetail(id, user);
    return <ExpertDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
