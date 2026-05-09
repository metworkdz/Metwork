import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2 } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { IncubatorsManager } from '@/components/features/admin/incubators-manager';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Incubators' };

export default async function AdminIncubatorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();

  // Enrich incubator rows with manager name
  const rows = data.incubators.map((inc) => {
    const manager = inc.managerId
      ? data.users.find((u) => u.id === inc.managerId)
      : undefined;
    return { ...inc, managerName: manager?.fullName };
  });

  // Only INCUBATOR-role users can be assigned as managers
  const managers = data.users
    .filter((u) => u.role === 'INCUBATOR' && u.status === 'ACTIVE')
    .map(({ id, fullName, email }) => ({ id, fullName, email }));

  const active    = rows.filter((r) => r.status === 'ACTIVE').length;
  const suspended = rows.filter((r) => r.status === 'SUSPENDED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.incubators.title')}
        subtitle={t('admin.incubators.subtitle')}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.incubators.statRegistered')} value={rows.length}  icon={Building2} />
        <StatCard label={t('admin.incubators.statActive')}     value={active}                        />
        <StatCard label={t('admin.incubators.statSuspended')}  value={suspended}                     />
      </div>

      <IncubatorsManager initial={rows} managers={managers} />
    </div>
  );
}
