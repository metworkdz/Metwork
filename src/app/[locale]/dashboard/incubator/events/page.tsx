import { setRequestLocale } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EventsManager } from '@/components/features/incubator/events-manager';
import { requireRole } from '@/lib/auth-guards';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncubatorEventsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Events"
        subtitle="Pitch nights, demo days, and meetups."
      />
      <EventsManager />
    </div>
  );
}
