/**
 * /dashboard/admin/analytics
 *
 * Benefit & pricing analytics for the admin team.
 * Shows how much Metwork discounts/gives away vs. membership revenue,
 * helping assess whether pricing is sustainable.
 */
import { setRequestLocale } from 'next-intl/server';
import {
  BarChart2, Gift, UserCheck, Wallet, TrendingDown,
  TrendingUp, Ticket, Star, Calendar, Users,
} from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function fmtDZD(n: number) {
  return `${n.toLocaleString('fr-DZ')} DZD`;
}

function fmtPct(n: number) {
  return `${n}%`;
}

const MONTH_LABELS: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

interface AnalyticsPayload {
  generatedAt: string;
  demographics: {
    totalUsers: number;
    maleCount: number;
    femaleCount: number;
    unknownCount: number;
    malePct: number;
    femalePct: number;
    byRole: Record<string, { total: number; male: number; female: number; unknown: number }>;
  };
  memberships: {
    activeBuilder: number;
    activeFounder: number;
    activeTotal: number;
    revenue: {
      total: number;
      thisMonth: number;
      discountTotal: number;
      purchasesWithDiscount: number;
      purchasesTotal: number;
    };
  };
  consultations: {
    freeQuota: {
      count: number;
      countThisMonth: number;
      estimatedValue: number;
      estimatedValueThisMonth: number;
      byMentor: Array<{ name: string; count: number; value: number }>;
    };
    paid: { count: number; revenue: number };
  };
  networkPass: {
    totalCheckIns: number;
    checkInsThisMonth: number;
    creditsIssuedThisMonth: number;
    creditsUsedThisMonth: number;
    utilizationRatePct: number;
    topSpaces: Array<{ name: string; count: number }>;
  };
  spaceBookings: { membershipDiscountEstimate: number };
  totals: { totalValueGiven: number; membershipRevenue: number; netBalance: number };
  monthlyTrend: Array<{
    month: string;
    membershipRevenue: number;
    freeSessions: number;
    networkPassSessions: number;
    spaceDiscount: number;
  }>;
}

export default async function AdminAnalyticsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);

  // Fetch analytics data
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  let analytics: AnalyticsPayload | null = null;
  try {
    const res = await fetch(`${appUrl}/api/admin/analytics`, {
      cache: 'no-store',
      headers: { 'x-internal-call': '1' },
    });
    if (res.ok) analytics = (await res.json()) as AnalyticsPayload;
  } catch {
    // fall through — show skeleton with zeros
  }

  // Fallback empty data
  const a = analytics ?? {
    generatedAt: new Date().toISOString(),
    demographics: {
      totalUsers: 0, maleCount: 0, femaleCount: 0, unknownCount: 0,
      malePct: 0, femalePct: 0, byRole: {},
    },
    memberships: {
      activeBuilder: 0, activeFounder: 0, activeTotal: 0,
      revenue: { total: 0, thisMonth: 0, discountTotal: 0, purchasesWithDiscount: 0, purchasesTotal: 0 },
    },
    consultations: {
      freeQuota: { count: 0, countThisMonth: 0, estimatedValue: 0, estimatedValueThisMonth: 0, byMentor: [] },
      paid: { count: 0, revenue: 0 },
    },
    networkPass: {
      totalCheckIns: 0, checkInsThisMonth: 0,
      creditsIssuedThisMonth: 0, creditsUsedThisMonth: 0, utilizationRatePct: 0, topSpaces: [],
    },
    spaceBookings: { membershipDiscountEstimate: 0 },
    totals: { totalValueGiven: 0, membershipRevenue: 0, netBalance: 0 },
    monthlyTrend: [],
  };

  const isPositive = a.totals.netBalance >= 0;

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        title="Benefit & Pricing Analytics"
        subtitle={`Showing how discounts and free benefits compare to membership revenue. Last updated: ${new Date(a.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}
      />

      {/* ── User Demographics ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          User Demographics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Users"
            value={a.demographics.totalUsers}
            hint={`${a.demographics.unknownCount} haven't provided sex info`}
            icon={Users}
          />
          {/* Male */}
          <Card>
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">Male</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{a.demographics.malePct}%</p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-blue-500"
                  style={{ width: `${a.demographics.malePct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {a.demographics.maleCount} user{a.demographics.maleCount !== 1 ? 's' : ''} of {a.demographics.maleCount + a.demographics.femaleCount} with data
              </p>
            </CardContent>
          </Card>
          {/* Female */}
          <Card>
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">Female</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{a.demographics.femalePct}%</p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-pink-500"
                  style={{ width: `${a.demographics.femalePct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {a.demographics.femaleCount} user{a.demographics.femaleCount !== 1 ? 's' : ''} of {a.demographics.maleCount + a.demographics.femaleCount} with data
              </p>
            </CardContent>
          </Card>
          {/* Visual split */}
          <Card>
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">Sex Split</p>
              <div className="mt-3 flex h-6 w-full overflow-hidden rounded-full">
                {a.demographics.malePct > 0 && (
                  <div className="bg-blue-500" style={{ width: `${a.demographics.malePct}%` }} title={`Male ${a.demographics.malePct}%`} />
                )}
                {a.demographics.femalePct > 0 && (
                  <div className="bg-pink-500" style={{ width: `${a.demographics.femalePct}%` }} title={`Female ${a.demographics.femalePct}%`} />
                )}
                {(a.demographics.malePct + a.demographics.femalePct) < 100 && a.demographics.totalUsers > 0 && (
                  <div className="flex-1 bg-muted" title="No data" />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-full bg-blue-500" /> Male {a.demographics.malePct}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-full bg-pink-500" /> Female {a.demographics.femalePct}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Per-role breakdown */}
        {Object.keys(a.demographics.byRole).length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Sex by Role</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Total</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Male</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Female</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Unknown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(a.demographics.byRole).map(([role, counts]) => {
                      const withData = counts.male + counts.female;
                      const mPct = withData > 0 ? Math.round((counts.male / withData) * 100) : 0;
                      const fPct = withData > 0 ? Math.round((counts.female / withData) * 100) : 0;
                      return (
                        <tr key={role} className="border-b border-border/50 last:border-0">
                          <td className="px-4 py-2.5 font-medium capitalize">{role.toLowerCase()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{counts.total}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-blue-600 dark:text-blue-400">
                            {counts.male} <span className="text-muted-foreground">({mPct}%)</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-pink-600 dark:text-pink-400">
                            {counts.female} <span className="text-muted-foreground">({fPct}%)</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {counts.unknown}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Summary KPIs ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Overall Balance
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Membership Revenue (all-time)"
            value={fmtDZD(a.totals.membershipRevenue)}
            hint={`This month: ${fmtDZD(a.memberships.revenue.thisMonth)}`}
            icon={TrendingUp}
          />
          <StatCard
            label="Total Value Given Away (all-time)"
            value={fmtDZD(a.totals.totalValueGiven)}
            hint="Free sessions + space discounts + membership promo discounts"
            icon={Gift}
          />
          <StatCard
            label="Net Balance"
            value={fmtDZD(a.totals.netBalance)}
            hint={isPositive ? '✅ Revenue > costs' : '⚠️ Costs exceed revenue — review pricing'}
            icon={isPositive ? TrendingUp : TrendingDown}
          />
          <StatCard
            label="Active Paid Members"
            value={a.memberships.activeTotal}
            hint={`Builder: ${a.memberships.activeBuilder} · Founder: ${a.memberships.activeFounder}`}
            icon={UserCheck}
          />
        </div>
      </section>

      {/* ── Membership Revenue ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Membership Revenue
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Total Revenue (all-time)"
            value={fmtDZD(a.memberships.revenue.total)}
            hint={`${a.memberships.revenue.purchasesTotal} total purchases`}
            icon={Wallet}
          />
          <StatCard
            label="Revenue This Month"
            value={fmtDZD(a.memberships.revenue.thisMonth)}
            icon={Calendar}
          />
          <StatCard
            label="Discounts on Memberships"
            value={fmtDZD(a.memberships.revenue.discountTotal)}
            hint={`Applied to ${a.memberships.revenue.purchasesWithDiscount} of ${a.memberships.revenue.purchasesTotal} purchases`}
            icon={Gift}
          />
        </div>
      </section>

      {/* ── Free Consultation Sessions ────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Free Consultation Sessions (Quota Benefit)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Free Sessions Given (all-time)"
            value={a.consultations.freeQuota.count}
            hint={`This month: ${a.consultations.freeQuota.countThisMonth}`}
            icon={Star}
          />
          <StatCard
            label="Estimated Value (all-time)"
            value={fmtDZD(a.consultations.freeQuota.estimatedValue)}
            hint={`This month: ${fmtDZD(a.consultations.freeQuota.estimatedValueThisMonth)}`}
            icon={TrendingDown}
          />
          <StatCard
            label="Paid Sessions (all-time)"
            value={a.consultations.paid.count}
            hint="Charged at full rate"
            icon={UserCheck}
          />
          <StatCard
            label="Paid Session Revenue"
            value={fmtDZD(a.consultations.paid.revenue)}
            icon={TrendingUp}
          />
        </div>

        {/* Per-mentor breakdown */}
        {a.consultations.freeQuota.byMentor.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Free Sessions by Mentor</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">Mentor</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">Sessions</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Est. Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.consultations.freeQuota.byMentor.map((row, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5 font-medium">{row.name}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="info">{row.count}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {fmtDZD(row.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Network Pass Sessions ─────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Network Pass — Free Coworking Sessions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Check-ins (all-time)"
            value={a.networkPass.totalCheckIns}
            hint={`This month: ${a.networkPass.checkInsThisMonth}`}
            icon={Ticket}
          />
          <StatCard
            label="Credits Issued This Month"
            value={a.networkPass.creditsIssuedThisMonth}
            hint="Total monthly allowance across all paid members"
            icon={Gift}
          />
          <StatCard
            label="Credits Used This Month"
            value={a.networkPass.creditsUsedThisMonth}
            icon={BarChart2}
          />
          <StatCard
            label="Credit Utilisation This Month"
            value={fmtPct(a.networkPass.utilizationRatePct)}
            hint={`${a.networkPass.creditsUsedThisMonth} / ${a.networkPass.creditsIssuedThisMonth} credits redeemed`}
            icon={isPositive ? TrendingUp : TrendingDown}
          />
        </div>

        {a.networkPass.topSpaces.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Top Partner Spaces by Visits</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">Space</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Total Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.networkPass.topSpaces.map((row, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5 font-medium">{row.name}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Badge variant="outline">{row.count}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Space Booking Discounts ───────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Space Booking Discounts (Founder Tier — 20% Off)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Estimated Discount Given (all-time)"
            value={fmtDZD(a.spaceBookings.membershipDiscountEstimate)}
            hint="20% off all wallet-paid space bookings by active Founder members"
            icon={Gift}
          />
          <Card>
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">How this is calculated</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                For each wallet-paid space booking by a Founder member, the stored{' '}
                <code className="rounded bg-muted px-1 text-xs">totalAmount</code> already reflects the
                20% discount. The original price would have been{' '}
                <strong>totalAmount ÷ 0.8</strong>, so the discount is{' '}
                <strong>totalAmount × 0.25</strong>. Cancelled bookings are excluded.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Month-by-month trend table ────────────────────────────────── */}
      {a.monthlyTrend.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Month-by-Month Trend ({new Date().getUTCFullYear()})
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="px-4 py-2.5 font-medium text-muted-foreground">Month</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Membership Revenue</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Free Consultations</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Network Pass Sessions</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Space Discount (est.)</th>
                      <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.monthlyTrend.map((row) => {
                      const totalGiven = row.spaceDiscount;
                      const net = row.membershipRevenue - totalGiven;
                      const [yr, mo] = row.month.split('-');
                      const label = `${MONTH_LABELS[mo!] ?? mo} ${yr}`;
                      return (
                        <tr key={row.month} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{label}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {fmtDZD(row.membershipRevenue)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                            {row.freeSessions} sessions
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {row.networkPassSessions} visits
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-orange-700 dark:text-orange-400">
                            {fmtDZD(row.spaceDiscount)}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
                            {net >= 0 ? '+' : ''}{fmtDZD(net)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Pricing health note ───────────────────────────────────────── */}
      <Card className={`border-2 ${isPositive ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950' : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'}`}>
        <CardContent className="p-5">
          <p className={`text-sm font-semibold ${isPositive ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}`}>
            {isPositive ? '✅ Pricing Health: Positive' : '⚠️ Pricing Health: Deficit'}
          </p>
          <p className={`mt-1 text-sm ${isPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {isPositive
              ? `Revenue (${fmtDZD(a.totals.membershipRevenue)}) exceeds total value given away (${fmtDZD(a.totals.totalValueGiven)}) by ${fmtDZD(a.totals.netBalance)}. Current pricing is sustainable.`
              : `Total value given away (${fmtDZD(a.totals.totalValueGiven)}) exceeds membership revenue (${fmtDZD(a.totals.membershipRevenue)}) by ${fmtDZD(Math.abs(a.totals.netBalance))}. Consider reviewing membership pricing or benefit limits.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
