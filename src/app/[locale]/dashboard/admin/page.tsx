import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2, MessageSquare, TrendingUp, Users, Wallet, BookOpen, UserCheck, UserMinus } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import {
  MobileGreeting,
  MobileQuickActions,
  MobileStatGrid,
} from '@/components/dashboard/mobile/mobile-overview';
import { mobileQuickActionsByRole } from '@/config/mobile-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/server/db/store';
import type { UserRole } from '@/types/auth';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const tRoot = await getTranslations();
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

  // ── Account deletion analytics ─────────────────────────────────────────
  const deletionLogs = (data.auditLogs ?? []).filter(
    (l) => l.action === 'ACCOUNT_DELETED',
  );
  const monthKey = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };
  const currentMonthKey = monthKey(now);
  const deletedThisMonth = deletionLogs.filter(
    (l) => monthKey(new Date(l.createdAt)) === currentMonthKey,
  ).length;
  const deletionsByRole: Record<UserRole, number> = {
    ENTREPRENEUR: 0,
    INVESTOR: 0,
    INCUBATOR: 0,
    TRAINER: 0,
    ADMIN: 0,
  };
  for (const log of deletionLogs) {
    const role = (log.details as { role?: UserRole } | undefined)?.role;
    if (role && role in deletionsByRole) deletionsByRole[role] += 1;
  }
  // Last 3 months trend, oldest → newest, formatted like "May 2026: 5"
  const monthFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const trendParts: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    const count = deletionLogs.filter(
      (l) => monthKey(new Date(l.createdAt)) === key,
    ).length;
    trendParts.push(`${monthFormatter.format(d)}: ${count}`);
  }
  const deletionTrend = trendParts.join(' · ');

  const activeMemberships = data.userMemberships.filter((m) => m.status === 'ACTIVE').length;

  return (
    <>
      {/* ── Mobile app UI (below lg) ─────────────────────────────────────── */}
      <div className="lg:hidden">
        <MobileGreeting title={t('admin.overview.greeting')} subtitle={t('admin.overview.subtitle')} />
        <MobileQuickActions
          actions={mobileQuickActionsByRole.ADMIN.map((a) => ({
            label: tRoot(a.labelKey),
            href: a.href,
            icon: a.icon,
          }))}
        />
        <MobileStatGrid
          stats={[
            { label: t('admin.overview.statTotalUsers'), value: totalUsers, hint: t('admin.overview.statTotalUsersHint', { count: newUsersThisMonth }), icon: Users },
            { label: t('admin.overview.statActiveIncubators'), value: activeIncubators, icon: Building2 },
            { label: t('admin.overview.statBookingRevenue'), value: `${bookingRevenue.toLocaleString()} DZD`, icon: TrendingUp },
            { label: t('admin.overview.statWalletFloat'), value: `${walletFloat.toLocaleString()} DZD`, icon: Wallet },
            { label: 'Active memberships', value: activeMemberships, icon: UserCheck, tone: 'gold' },
            { label: t('admin.overview.statPendingMentorReqs'), value: pendingMentorReqs, icon: BookOpen, tone: 'amber' },
            { label: t('admin.overview.statUnhandledContacts'), value: unhandledContacts, icon: MessageSquare, tone: 'amber' },
          ]}
        />
      </div>

      {/* ── Desktop (lg+) — unchanged ────────────────────────────────────── */}
      <div className="hidden space-y-6 lg:block">
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

      {/* Account deletions analytics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserMinus className="size-4 text-muted-foreground" />
            Account deletions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total deleted</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{deletionLogs.length}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">This month</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{deletedThisMonth}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-muted-foreground">By role</p>
              <p className="mt-1 text-sm">
                Entrepreneur:{' '}
                <span className="font-semibold">{deletionsByRole.ENTREPRENEUR}</span>{' '}
                · Incubator:{' '}
                <span className="font-semibold">{deletionsByRole.INCUBATOR}</span>{' '}
                · Investor:{' '}
                <span className="font-semibold">{deletionsByRole.INVESTOR}</span>{' '}
                · Admin:{' '}
                <span className="font-semibold">{deletionsByRole.ADMIN}</span>
              </p>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Last 3 months</p>
            <p className="mt-1 text-sm">{deletionTrend}</p>
          </div>
        </CardContent>
      </Card>
      </div>
    </>
  );
}
