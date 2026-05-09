import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Building2, Calendar, TrendingUp, Wallet, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';
import { db } from '@/server/db/store';
import { platformCommissions } from '@/config/memberships';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Incubator dashboard' };

export default async function IncubatorDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);

  const wallet = data.wallets.find((w) => w.userId === user.id);
  const walletBalance = wallet?.balance ?? 0;

  if (!incubator) {
    // Edge case: incubator profile not created yet
    return (
      <div className="space-y-6">
        <DashboardWelcome
          greeting={t('incubator.overview.greetingNoProfile', { name: user.fullName.split(' ')[0] ?? user.fullName })}
          subtitle={t('incubator.overview.subtitleNoProfile')}
        />
        <p className="text-sm text-muted-foreground">
          Your incubator profile is being set up. Please contact support if this persists.
        </p>
      </div>
    );
  }

  const ownedSpaceIds = new Set(
    data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id && s.status === 'ACTIVE').map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
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
  const commissionRate =
    incubator.subscriptionTier === 'COMMISSION' ? platformCommissions.incubatorBooking : 0;
  const netMtd = Math.round(grossMtd * (1 - commissionRate));

  // Enrolled members (unique). Offline bookings have userId === null — exclude
  // them so the Set never inflates the count with a null slot.
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
        greeting={t('incubator.overview.greeting', { name: user.fullName.split(' ')[0] ?? user.fullName })}
        subtitle={t('incubator.overview.subtitle', { incubatorName: incubator.name, city: incubator.city })}
        action={
          <Button asChild>
            <Link href="/dashboard/incubator/spaces">{t('incubator.overview.manageSpaces')}</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('incubator.overview.statActiveSpaces')}
          value={ownedSpaceIds.size}
          icon={Building2}
        />
        <StatCard
          label={t('incubator.overview.statBookingsThisMonth')}
          value={bookingsThisMonth.length}
          icon={Calendar}
          hint={t('incubator.overview.statBookingsHint', { count: allBookings.filter((b) => b.status === 'PENDING').length })}
        />
        <StatCard
          label={t('incubator.overview.statRevenueMtd')}
          value={`${netMtd.toLocaleString()} DZD`}
          hint={t('incubator.overview.statRevenueHint')}
          icon={TrendingUp}
        />
        <StatCard
          label={t('incubator.overview.statMembersEnrolled')}
          value={memberIds.size}
          icon={Users}
          hint={t('incubator.overview.statMembersHint')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('incubator.overview.statPrograms')}
          value={data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).length}
          icon={Calendar}
        />
        <StatCard
          label={t('incubator.overview.statWalletBalance')}
          value={`${walletBalance.toLocaleString()} DZD`}
          icon={Wallet}
        />
      </div>
    </div>
  );
}
