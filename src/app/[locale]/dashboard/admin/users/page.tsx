import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Users, UserCheck, ShieldOff } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { AdminUsersTable, type AdminUserView } from '@/components/features/admin/admin-users-table';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminUsersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();

  // Strip passwordHash before sending to the client component
  const users: AdminUserView[] = data.users.map(({ passwordHash: _, ...u }) => {
    void _;
    return u;
  });

  const active    = users.filter((u) => u.status === 'ACTIVE').length;
  const pending   = users.filter((u) => u.status === 'PENDING_VERIFICATION').length;
  const suspended = users.filter((u) => u.status === 'SUSPENDED' || u.status === 'BANNED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.users.statActive')}    value={active}    icon={UserCheck} />
        <StatCard label={t('admin.users.statPending')}   value={pending}   icon={Users} />
        <StatCard label={t('admin.users.statSuspended')} value={suspended} icon={ShieldOff} />
      </div>

      <AdminUsersTable initial={users} />
    </div>
  );
}
