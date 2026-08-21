import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getProgramDetail } from '@/server/metworkcrm/services/programs';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { ProgramDetail } from '@/components/metworkcrm/programs/program-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { program } = await getProgramDetail(id, { role: 'ADMIN' });
    return { title: program.title };
  } catch {
    return { title: 'Programme' };
  }
}

export default async function CrmProgramDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getProgramDetail(id, user);
    return <ProgramDetail initial={detail} isAdmin={user.role === 'ADMIN'} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
