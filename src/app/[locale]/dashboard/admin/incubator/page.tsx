import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2, Calendar, TrendingUp, Wallet, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { getOrCreateAdminIncubator } from '@/lib/admin-incubator';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import { db, defaultPlatformConfig } from '@/server/db/store';
import { resolveCommissionRates } from '@/server/payments/commission';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'My Incubator' };

export default async function AdminIncubatorOverviewPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['ADMIN']);

  const incubator = await getOrCreateAdminIncubator(user.id);
  const data = await db.read();

  const wallet = data.wallets.find((w) => w.userId === user.id);
  const walletBalance = wallet?.balance ?? 0;

  const ownedSpaceIds = new Set(
    (data.spaces ?? [])
      .filter((s) => s.incubatorId === incubator.id && s.isActive)
      .map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  const allBookings = data.bookings.filter(
    (b) =>
      (b.itemKind === 'SPACE' && ownedSpaceIds.has(b.itemId)) ||
      (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId)),
  );

  const thisMonth = new Date().toISOString().slice(0, 7);
  const bookingsThisMonth = allBookings.filter(
    (b) => b.createdAt.startsWith(thisMonth) && b.status !== 'CANCELLED' && b.status !== 'REFUNDED',
  );

  const grossMtd = bookingsThisMonth.reduce((s, b) => s + b.totalAmount, 0);
  const subCode = incubator.subscriptionCode ?? incubator.subscriptionTier ?? 'COMMISSION';
  // Central engine receiver rate (FLAT ⇒ 0). Net prefers the commission frozen
  // on each booking at settlement; un-settled bookings use the live estimate.
  const cfg = { ...defaultPlatformConfig, ...data.meta?.platformConfig };
  const { receiverRate: commissionRate } = resolveCommissionRates(subCode, cfg);
  const commissionMtd = bookingsThisMonth.reduce(
    (s, b) => s + (b.commissionAmount ?? Math.round(b.totalAmount * commissionRate)),
    0,
  );
  const netMtd = grossMtd - commissionMtd;

  // Offline bookings have userId === null — exclude so the Set doesn't inflate.
  const memberIds = new Set(
    data.bookings
      .filter(
        (b) =>
          b.itemKind === 'PROGRAM' &&
          ownedProgramIds.has(b.itemId) &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED' &&
          b.userId !== null,
      )
      .map((b) => b.userId),
  );

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting={`${incubator.name} — Incubator`}
        subtitle={t('admin.incubator.overview.subtitle', { city: incubator.city })}
        action={
          <Button asChild>
            <Link href="/dashboard/admin/incubator/spaces">{t('admin.incubator.overview.manageSpaces')}</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('admin.incubator.overview.statActiveSpaces')} value={ownedSpaceIds.size} icon={Building2} />
        <StatCard
          label={t('admin.incubator.overview.statBookingsThisMonth')}
          value={bookingsThisMonth.length}
          icon={Calendar}
          hint={t('admin.incubator.overview.statBookingsHint', { count: allBookings.filter((b) => b.status === 'PENDING').length })}
        />
        <StatCard
          label={t('admin.incubator.overview.statRevenueMtd')}
          value={`${netMtd.toLocaleString()} DZD`}
          hint={t('admin.incubator.overview.statRevenueHint')}
          icon={TrendingUp}
        />
        <StatCard
          label={t('admin.incubator.overview.statMembersEnrolled')}
          value={memberIds.size}
          icon={Users}
          hint={t('admin.incubator.overview.statMembersHint')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('admin.incubator.overview.statPrograms')}
          value={(data.programs ?? []).filter((p) => p.incubatorId === incubator.id).length}
          icon={Calendar}
        />
        <StatCard
          label={t('admin.incubator.overview.statWalletBalance')}
          value={`${walletBalance.toLocaleString()} DZD`}
          icon={Wallet}
        />
      </div>
    </div>
  );
}
