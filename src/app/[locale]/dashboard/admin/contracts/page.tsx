import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { ContractsManager } from '@/components/features/admin/contracts-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Admin consultant-contracts queue.
 *
 * Deliberately its own page rather than a section of the audit log: the audit
 * log is a read-only record of admin actions, while this screen issues, sends
 * and voids legal instruments. Contract actions still write into that log.
 */
export default async function AdminContractsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.contracts.title')}
        subtitle={t('admin.contracts.subtitle')}
      />
      <ContractsManager />
    </div>
  );
}
