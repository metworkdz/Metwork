import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { EventsManager } from '@/components/features/incubator/events-manager';
import { requireRole } from '@/lib/auth-guards';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Events' };
export const dynamic = 'force-dynamic';

export default async function TrainerEventsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['TRAINER']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.events.title')}
        subtitle={t('incubator.events.subtitle')}
      />
      <EventsManager />
    </div>
  );
}
