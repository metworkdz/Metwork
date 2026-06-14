import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProgramsManager } from '@/components/features/incubator/programs-manager';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Programs' };
export const dynamic = 'force-dynamic';

export default async function TrainerProgramsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['TRAINER']);

  const data = await db.read();
  const provider = data.incubators.find((i) => i.managerId === user.id);
  const published = provider
    ? (data.programs ?? []).filter((p) => p.incubatorId === provider.id && p.isActive).length
    : 0;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.programs.title')}
        subtitle={t('incubator.programs.subtitle', { count: published })}
      />
      <ProgramsManager />
    </div>
  );
}
