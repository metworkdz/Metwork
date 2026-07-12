import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EventsManager } from '@/components/features/incubator/events-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Events' };

export default async function AdminIncubatorEventsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  // Ensure the admin incubator record exists (no-op if already created).
  await getOrCreateAdminIncubator(user.id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubator.events.title')}
        subtitle={t('admin.incubator.events.subtitle')}
      />
      <EventsManager />
    </div>
  );
}
