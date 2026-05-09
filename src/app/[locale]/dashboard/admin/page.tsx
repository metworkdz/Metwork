import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2, MessageSquare, TrendingUp, Users, Wallet, BookOpen, UserCheck } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();

  const now     = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalUsers     = data.users.length;
  const activeIncubators = data.users.filter(
    (u) => u.role === 'INCUBATOR' && u.status === 'ACTIVE',
  ).length;

  const newUsersThisMonth = data.users.filter(
    (u) => u.createdAt >= monthStart,
  ).length;

  // Wallet float = sum of all active wallet balances
  const walletFloat = data.wallets
    .filter((w) => w.status === 'ACTIVE')
    .reduce((sum, w) => sum + w.balance, 0);

  // Total booking revenue (all-time PAYMENT transactions completed)
  const bookingRevenue = data.transactions
    .filter((t) => t.type === 'PAYMENT' && t.status === 'COMPLETED')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const totalBookings      = data.bookings.length;
  const pendingMentorReqs  = data.mentorBookings.filter((b) => b.status === 'PENDING').length;
  const unhandledContacts  = data.contactSubmissions.filter((s) => !s.handled).length;

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting={t('admin.overview.greeting')}
        subtitle={t('admin.overview.subtitle')}
      />

      {/* Primary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('admin.overview.statTotalUsers')}
          value={totalUsers}
          hint={t('admin.overview.statTotalUsersHint', { count: newUsersThisMonth })}
          icon={Users}
        />
        <StatCard
          label={t('admin.overview.statActiveIncubators')}
          value={activeIncubators}
          icon={Building2}
        />
        <StatCard
          label={t('admin.overview.statBookingRevenue')}
          value={`${bookingRevenue.toLocaleString()} DZD`}
          hint={t('admin.overview.statBookingRevenueHint', { count: totalBookings })}
          icon={TrendingUp}
        />
        <StatCard
          label={t('admin.overview.statWalletFloat')}
          value={`${walletFloat.toLocaleString()} DZD`}
          hint={t('admin.overview.statWalletFloatHint')}
          icon={Wallet}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active memberships"
          value={data.userMemberships.filter((m) => m.status === 'ACTIVE').length}
          icon={UserCheck}
        />
        <StatCard
          label={t('admin.overview.statPendingMentorReqs')}
          value={pendingMentorReqs}
          hint={pendingMentorReqs > 0 ? 'Needs review' : 'All clear'}
          icon={BookOpen}
        />
        <StatCard
          label={t('admin.overview.statUnhandledContacts')}
          value={unhandledContacts}
          hint={unhandledContacts > 0 ? 'In contact inbox' : 'Inbox zero'}
          icon={MessageSquare}
        />
      </div>
    </div>
  );
}
