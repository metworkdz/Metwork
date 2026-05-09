import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WalletDashboard } from '@/components/features/wallet/wallet-dashboard';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurWalletPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ENTREPRENEUR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.wallet.title')}
        subtitle={t('entrepreneur.wallet.subtitle')}
      />
      <WalletDashboard />
    </div>
  );
}
