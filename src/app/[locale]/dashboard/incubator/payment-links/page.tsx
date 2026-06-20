import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { PaymentLinksManager } from '@/components/features/incubator/payment-links-manager';
import { requireRole } from '@/lib/auth-guards';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Payment Links' };

export default async function IncubatorPaymentLinksPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.paymentLinks.title')}
        subtitle={t('incubator.paymentLinks.subtitle')}
      />
      <PaymentLinksManager />
    </div>
  );
}
