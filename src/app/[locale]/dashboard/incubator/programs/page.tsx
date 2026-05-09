import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProgramsManager } from '@/components/features/incubator/programs-manager';
import { requireRole } from '@/lib/auth-guards';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Programs' };

export default async function IncubatorProgramsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  const programs = incubator
    ? data.incubatorPrograms
        .filter((p) => p.incubatorId === incubator.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  const published = programs.filter((p) => p.status === 'PUBLISHED').length;

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
