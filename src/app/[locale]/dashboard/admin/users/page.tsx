import { setRequestLocale } from 'next-intl/server';
import { Users, UserCheck, ShieldOff } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { AdminUsersTable } from '@/components/features/admin/admin-users-table';
import { requireRole } from '@/lib/auth-guards';
import { demoAdminUsers } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminUsersPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);

  const users = demoAdminUsers;
  const active = users.filter((u) => u.status === 'ACTIVE').length;
  const pending = users.filter((u) => u.status === 'PENDING_VERIFICATION').length;
  const suspended = users.filter((u) => u.status === 'SUSPENDED' || u.status === 'BANNED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Users"
        subtitle="Search, suspend, reinstate, and audit Metwork members."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active" value={active} icon={UserCheck} />
        <StatCard label="Pending verification" value={pending} icon={Users} />
        <StatCard label="Suspended / banned" value={suspended} icon={ShieldOff} />
      </div>

      <AdminUsersTable initial={users} />

      <p className="text-xs text-muted-foreground">
        Showing demo data — moderation actions are stubbed until the admin user-management API ships.
      </p>
    </div>
  );
}
