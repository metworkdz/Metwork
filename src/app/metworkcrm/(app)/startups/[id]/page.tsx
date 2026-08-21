import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getStartupDetail } from '@/server/metworkcrm/services/startups';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { StartupDetail } from '@/components/metworkcrm/startups/startup-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { startup } = await getStartupDetail(id);
    return { title: startup.displayNameCache ?? startup.name ?? 'Startup' };
  } catch {
    return { title: 'Startup' };
  }
}

export default async function CrmStartupDetailPage({ params }: Params) {
  await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getStartupDetail(id);
    return <StartupDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
