import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ContractsManager } from '@/components/features/incubator/contracts-manager';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contracts' };

export default async function IncubatorContractsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('incubator.contracts');
  const user = await requireRole(['INCUBATOR']);

  const inc = await findIncubatorByUserEmail(user.email);
  const templates = inc
    ? (await db.read()).contractTemplates
        .filter((c) => c.incubatorId === inc.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <ContractsManager initial={templates} />
    </div>
  );
}
