import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WalletDashboard } from '@/components/features/wallet/wallet-dashboard';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** The shared wallet: payment-link earnings land here, withdrawals leave from here. */
export default async function FreelancerWalletPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.wallet');
  await requireRole(['FREELANCER']);
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <WalletDashboard />
    </div>
  );
}
