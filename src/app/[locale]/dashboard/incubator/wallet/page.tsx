import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WalletDashboard } from '@/components/features/wallet/wallet-dashboard';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncubatorWalletPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Wallet"
        subtitle="Net booking revenue lands here. Top up to settle platform fees on demand."
      />
      <WalletDashboard />
    </div>
  );
}
