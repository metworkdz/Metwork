import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { RevenueDashboard } from '@/components/features/incubator/revenue-dashboard';
import { requireRole } from '@/lib/auth-guards';
import { db, defaultPlatformConfig } from '@/server/db/store';
import { resolveCommissionRates } from '@/server/payments/commission';
import { getEffectiveSubscriptionCode } from '@/server/incubator/service';

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

  // Effective plan applies read-time expiry — a lapsed Pro plan reverts to commission.
  const subCode = getEffectiveSubscriptionCode(incubator);
  const cfg = { ...defaultPlatformConfig, ...data.meta?.platformConfig };
  const { receiverRate: commissionRate } = resolveCommissionRates(subCode, cfg);

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

  // Commission prefers the amount frozen at settlement; un-settled bookings
  // fall back to the live receiver-rate estimate (central engine).
  const bucketsMap = new Map<string, { gross: number; commission: number; bookings: number }>();
  for (const b of relevant) {
    const ym = toYearMonth(b.createdAt);
    const cur = bucketsMap.get(ym) ?? { gross: 0, commission: 0, bookings: 0 };
    cur.gross += b.totalAmount;
    cur.commission += b.commissionAmount ?? Math.round(b.totalAmount * commissionRate);
    cur.bookings += 1;
    bucketsMap.set(ym, cur);
  }

  const buckets = Array.from(bucketsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { gross, commission, bookings }]) => {
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
      subscriptionTier: subCode,
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
