import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EventsManager } from '@/components/features/incubator/events-manager';
import { db } from '@/server/db/store';

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
  const incubator = await getOrCreateAdminIncubator(user.id);

  const data = await db.read();
  const events = (data.events ?? [])
    .filter((e) => e.incubatorId === incubator.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
