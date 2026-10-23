import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { redirect } from '@/i18n/routing';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WalletDashboard } from '@/components/features/wallet/wallet-dashboard';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurWalletPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ENTREPRENEUR', 'FREELANCER']);
  // Emails and payment returns link here; freelancers have their own page.
  if (user.role === 'FREELANCER') redirect({ href: '/dashboard/freelancer/wallet', locale });

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
