import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { SpacesManager } from '@/components/features/incubator/spaces-manager';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Spaces' };

export default async function IncubatorSpacesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  const spaces = incubator
    ? (data.spaces ?? [])
        .filter((s) => s.incubatorId === incubator.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  const active = spaces.filter((s) => s.status === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.spaces.title')}
        subtitle={t('incubator.spaces.subtitle', { count: active })}
      />
      <SpacesManager />
    </div>
  );
}
