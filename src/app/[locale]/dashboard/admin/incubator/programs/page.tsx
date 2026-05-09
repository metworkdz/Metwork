import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProgramsManager } from '@/components/features/incubator/programs-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Programs' };

export default async function AdminIncubatorProgramsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const incubator = await getOrCreateAdminIncubator(user.id);
  const data = await db.read();

  const programs = data.incubatorPrograms
    .filter((p) => p.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const published = programs.filter((p) => p.status === 'PUBLISHED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubator.programs.title')}
        subtitle={t('admin.incubator.programs.subtitle', { count: published })}
      />
      <ProgramsManager initial={programs} />
    </div>
  );
}
