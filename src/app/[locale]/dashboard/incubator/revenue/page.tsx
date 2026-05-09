import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { RevenueDashboard } from '@/components/features/incubator/revenue-dashboard';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { platformCommissions } from '@/config/memberships';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Revenue' };

function toYearMonth(iso: string): string {
  return iso.slice(0, 7);
}

export default async function IncubatorRevenuePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INCUBATOR']);

  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);

  if (!incubator) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader title={t('incubator.revenue.title')} subtitle={t('incubator.revenue.subtitleNoProfile')} />
      </div>
    );
  }

  const commissionRate =
    incubator.subscriptionTier === 'COMMISSION' ? platformCommissions.incubatorBooking : 0;

  const ownedSpaceIds = new Set(
    (data.spaces ?? []).filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
  );
  const ownedProgramIds = new Set(
    (data.programs ?? []).filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
  );

  const relevant = data.bookings.filter(
    (b) =>
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED' &&
      (
        (b.itemKind === 'SPACE' && ownedSpaceIds.has(b.itemId)) ||
        (b.itemKind === 'PROGRAM' && ownedProgramIds.has(b.itemId))
      ),
  );

  const bucketsMap = new Map<string, { gross: number; bookings: number }>();
  for (const b of relevant) {
    const ym = toYearMonth(b.createdAt);
    const cur = bucketsMap.get(ym) ?? { gross: 0, bookings: 0 };
    cur.gross += b.totalAmount;
    cur.bookings += 1;
    bucketsMap.set(ym, cur);
  }

  const buckets = Array.from(bucketsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { gross, bookings }]) => {
      const commission = Math.round(gross * commissionRate);
      return { month, gross, commission, net: gross - commission, bookings };
    });

  const totals = buckets.reduce(
    (acc, b) => ({
      gross: acc.gross + b.gross,
      commission: acc.commission + b.commission,
      net: acc.net + b.net,
      bookings: acc.bookings + b.bookings,
    }),
    { gross: 0, commission: 0, net: 0, bookings: 0 },
  );

  const thisMonth = toYearMonth(new Date().toISOString());
  const mtd = buckets.find((b) => b.month === thisMonth) ?? {
    gross: 0, commission: 0, net: 0, bookings: 0,
  };

  const revenueData = {
    incubator: {
      id: incubator.id,
      name: incubator.name,
      subscriptionTier: incubator.subscriptionTier ?? 'COMMISSION',
      commissionRate,
    },
    totals,
    mtd,
    buckets,
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('incubator.revenue.title')}
        subtitle={t('incubator.revenue.subtitle')}
      />
      <RevenueDashboard data={revenueData} />
    </div>
  );
}
