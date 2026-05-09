import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EventsManager } from '@/components/features/incubator/events-manager';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncubatorEventsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  const events = incubator
    ? (data.incubatorEvents ?? [])
        .filter((e) => e.incubatorId === incubator.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.events.title')}
        subtitle={t('incubator.events.subtitle')}
      />
      <EventsManager initial={events} />
    </div>
  );
}
