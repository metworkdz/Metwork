import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { SpacesManager } from '@/components/features/incubator/spaces-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Spaces' };

export default async function AdminIncubatorSpacesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const incubator = await getOrCreateAdminIncubator(user.id);
  const data = await db.read();

  const spaces = (data.spaces ?? [])
    .filter((s) => s.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const active = spaces.filter((s) => s.isActive).length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubator.spaces.title')}
        subtitle={t('admin.incubator.spaces.subtitle', { count: active })}
      />
      <SpacesManager />
    </div>
  );
}
