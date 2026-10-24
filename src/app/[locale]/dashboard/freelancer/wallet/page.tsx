import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WalletDashboard } from '@/components/features/wallet/wallet-dashboard';
import { WithdrawGateBanner } from '@/components/features/freelancer/withdraw-gate-banner';
import { db } from '@/server/db/store';
import { withdrawalBlock } from '@/server/freelancer-contracts/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** The shared wallet: payment-link earnings land here, withdrawals leave from here. */
export default async function FreelancerWalletPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.wallet');
  const session = await requireRole(['FREELANCER']);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id);
  const block = user ? withdrawalBlock(data, user) : null;
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      {block && <WithdrawGateBanner block={block} />}
      <WalletDashboard />
    </div>
  );
}
