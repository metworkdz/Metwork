import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StartupListingsManager } from '@/components/features/entrepreneur/startup-listings-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Marketplace' };

export default async function EntrepreneurMarketplacePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ENTREPRENEUR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.marketplace.title')}
        subtitle={t('entrepreneur.marketplace.subtitle')}
      />
      <StartupListingsManager />
    </div>
  );
}
