import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ClientsManager } from '@/components/features/incubator/clients-manager';
import { InvoicingPathsProvider } from '@/components/features/incubator/invoicing-paths';
import { FREELANCER_INVOICING_PATHS } from '@/config/freelancer-invoicing';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FreelancerClientsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.clients');
  await requireRole(['FREELANCER']);
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <InvoicingPathsProvider paths={FREELANCER_INVOICING_PATHS}>
        <ClientsManager />
      </InvoicingPathsProvider>
    </div>
  );
}
