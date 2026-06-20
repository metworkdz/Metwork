import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BarChart2, Building2, Calendar, TrendingUp, UsersRound, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import {
  MobileGreeting,
  MobileQuickActions,
  MobileStatGrid,
  MobileSection,
  MobileListRow,
  MobileEmpty,
} from '@/components/dashboard/mobile/mobile-overview';
import { mobileQuickActionsByRole } from '@/config/mobile-nav';
import { db } from '@/server/db/store';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { IncubatorPendingApprovalBanner } from '@/components/features/incubator/pending-approval-banner';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const dynamic = 'force-dynamic';

export default async function IncubatorDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const tRoot = await getTranslations();
  const user = await requireRole(['INCUBATOR']);

  // Load real stats
  const inc  = await findIncubatorByUserEmail(user.email);
  const data = await db.read();

  const today        = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7); // YYYY-MM

  // Spaces owned by this incubator
  const mySpaces = inc
    ? (data.spaces ?? []).filter((s) => s.incubatorId === inc.id)
    : [];

  // Bookings this month across all owned spaces/programs/events
  let bookingsThisMonth = 0;
  let mrrIncome = 0;

  if (inc) {
    const spaceIds   = new Set(mySpaces.map((s) => s.id));
    const programIds = new Set((data.programs ?? []).filter((p) => p.incubatorId === inc.id).map((p) => p.id));
    const eventIds   = new Set((data.events   ?? []).filter((e) => e.incubatorId === inc.id).map((e) => e.id));

    bookingsThisMonth = (data.bookings ?? []).filter((b) => {
      const inMonth = b.createdAt?.startsWith(currentMonth);
      const owned   =
        (b.itemKind === 'SPACE'   && spaceIds.has(b.itemId)) ||
        (b.itemKind === 'PROGRAM' && programIds.has(b.itemId)) ||
        (b.itemKind === 'EVENT'   && eventIds.has(b.itemId));
      return inMonth && owned;
    }).length;

    // MRR from manual income records (current month)
    mrrIncome = (data.income ?? [])
      .filter((o) => o.incubatorId === inc.id && o.date.startsWith(currentMonth))
      .reduce((s, o) => s + o.amount, 0);
  }

  // Client count
  const myClients = inc
    ? (data.clients ?? []).filter((c) => c.incubatorId === inc.id)
    : [];
  const clientCount = myClients.length;
  const recentClients = [...myClients]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);

  return (
    <>
      {inc?.status === 'PENDING' && (
        <div className="mb-4">
          <IncubatorPendingApprovalBanner />
        </div>
      )}

      {/* ── Mobile app UI (below lg) ─────────────────────────────────────── */}
      <div className="lg:hidden">
        <MobileGreeting
          title={`Hello, ${user.fullName.split(' ')[0]}`}
          subtitle="Manage your spaces, programs & clients."
        />
        <MobileQuickActions
          actions={mobileQuickActionsByRole.INCUBATOR.map((a) => ({
            label: tRoot(a.labelKey),
            href: a.href,
            icon: a.icon,
          }))}
        />
        <MobileStatGrid
          stats={[
            { label: 'Active spaces', value: mySpaces.length, icon: Building2 },
            { label: 'Bookings (MTD)', value: bookingsThisMonth, icon: Calendar, tone: 'blue' },
            { label: 'Income (MTD)', value: formatCurrency(mrrIncome, locale as Locale), icon: TrendingUp },
            { label: 'Clients', value: clientCount, icon: UsersRound, tone: 'amber' },
          ]}
        />
        <MobileSection
          title={tRoot('dashboard.recentClients')}
          actionLabel={tRoot('common.viewAll')}
          actionHref="/dashboard/incubator/clients"
        >
          {recentClients.length === 0 ? (
            <MobileEmpty icon={UsersRound} text={tRoot('dashboard.nothingYet')} />
          ) : (
            recentClients.map((c) => (
              <MobileListRow
                key={c.id}
                icon={UsersRound}
                tone="amber"
                title={c.fullName}
                meta={c.companyName ?? c.email}
                href="/dashboard/incubator/clients"
              />
            ))
          )}
        </MobileSection>
      </div>

      {/* ── Desktop (lg+) — unchanged ────────────────────────────────────── */}
      <div className="hidden space-y-6 lg:block">
      <DashboardWelcome
        greeting={`Hello, ${user.fullName.split(' ')[0]}`}
        subtitle="Manage your spaces, programs, clients, and finances."
        action={
          <Button asChild>
            <Link href="/dashboard/incubator/analytics">View analytics</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Active spaces"
          value={mySpaces.length}
          icon={Building2}
        />
        <StatCard
          label="Bookings this month"
          value={bookingsThisMonth}
          icon={Calendar}
        />
        <StatCard
          label="Income (MTD)"
          value={formatCurrency(mrrIncome, locale as Locale)}
          hint="Manual income records"
          icon={TrendingUp}
        />
        <StatCard
          label="Clients"
          value={clientCount}
          icon={UsersRound}
        />
        <StatCard
          label="Analytics"
          value="View report →"
          hint="Income, expenses, net profit"
          icon={BarChart2}
        />
        <StatCard
          label="Wallet"
          value="—"
          hint="Platform wallet balance"
          icon={Wallet}
        />
      </div>
      </div>
    </>
  );
}
