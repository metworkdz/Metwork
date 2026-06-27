import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { PaymentsDashboard } from '@/components/features/admin/payments/payments-dashboard';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminPaymentsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.payments.title')}
        subtitle={t('admin.payments.subtitle')}
      />
      <PaymentsDashboard />
    </div>
  );
}
