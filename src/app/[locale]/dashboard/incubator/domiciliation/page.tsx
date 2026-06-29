import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { DomiciliationRequestsManager } from '@/components/features/incubator/domiciliation-requests-manager';
import { requireRole } from '@/lib/auth-guards';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Domiciliation' };

export default async function IncubatorDomiciliationPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('incubator.domiciliation');
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <DomiciliationRequestsManager />
    </div>
  );
}
