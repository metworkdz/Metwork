import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { WithdrawalsManager } from '@/components/features/admin/withdrawals-manager';
import { MentorWithdrawalsManager } from '@/components/features/admin/mentor-withdrawals-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminWithdrawalsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.withdrawals.title')}
        subtitle={t('admin.withdrawals.subtitle')}
      />
      <WithdrawalsManager />
      <MentorWithdrawalsManager />
    </div>
  );
}
