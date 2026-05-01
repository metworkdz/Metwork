import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WalletDashboard } from '@/components/features/wallet/wallet-dashboard';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurWalletPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ENTREPRENEUR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Wallet"
        subtitle="Top up to book spaces, programs, and events with one click."
      />
      <WalletDashboard />
    </div>
  );
}
