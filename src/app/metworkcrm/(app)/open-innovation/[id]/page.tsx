import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getOiProjectDetail } from '@/server/metworkcrm/services/oi-projects';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { OiProjectDetail } from '@/components/metworkcrm/oi-projects/oi-project-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { project } = await getOiProjectDetail(id, { role: 'ADMIN' });
    return { title: project.title };
  } catch {
    return { title: 'Projet Open Innovation' };
  }
}

export default async function CrmOiProjectDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getOiProjectDetail(id, user);
    return <OiProjectDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
