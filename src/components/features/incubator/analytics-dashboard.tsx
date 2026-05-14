'use client';

/**
 * Financial analytics dashboard.
 * Fetches GET /api/incubator/analytics and renders:
 *   - KPI cards (income, expenses, net profit, MRR, bookings)
 *   - Revenue by service (horizontal bar chart, pure CSS)
 *   - Income vs Expenses trend (SVG line/area chart)
 * No external chart library required.
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BarChart2,
  Calendar,
  Loader2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

/* ── Types ── */
interface TrendPoint {
  period: string;
  income: number;
  expenses: number;
  net: number;
}

interface ServiceRevenue {
  name: string;
  amount: number;
}

interface AnalyticsData {
  from: string;
  to: string;
  grain: 'day' | 'week' | 'month';
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  mrr: number;
  bookingCount: number;
  revenueByService: ServiceRevenue[];
  trend: TrendPoint[];
}

/* ── KPI Card ── */
function KpiCard({
  label,
  value,
  sub,
  positive,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
              className={[
                'mt-0.5 truncate text-xl font-bold',
                positive === true  ? 'text-green-600 dark:text-green-400' :
                positive === false ? 'text-destructive' : '',
              ].filter(Boolean).join(' ')}
            >
              {value}
            </p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="rounded-lg bg-muted/60 p-2">
            <Icon className="size-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Horizontal bar (revenue by service) ── */
function ServiceBars({ items, locale }: { items: ServiceRevenue[]; locale: Locale }) {
  const t = useTranslations('incubator.analytics');
  if (items.length === 0) return (
    <p className="py-6 text-center text-sm text-muted-foreground">{t('noRevenueData')}</p>
  );
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.name}>
          <div className="flex items-center justify-between text-xs">
            <span className="truncate font-medium">{item.name}</span>
            <span className="ml-2 shrink-0 text-muted-foreground">{formatCurrency(item.amount, locale)}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${(item.amount / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── SVG trend chart ── */
function TrendChart({ points, locale }: { points: TrendPoint[]; locale: Locale }) {
  const t = useTranslations('incubator.analytics');
  if (points.length === 0) return (
    <p className="py-6 text-center text-sm text-muted-foreground">{t('noTrendData')}</p>
  );

  const W = 600, H = 200, PAD = { top: 16, right: 16, bottom: 36, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allValues = points.flatMap((p) => [p.income, p.expenses]);
  const maxVal = Math.max(...allValues, 1);

  function x(i: number) { return PAD.left + (i / Math.max(points.length - 1, 1)) * innerW; }
  function y(v: number) { return PAD.top + innerH - (v / maxVal) * innerH; }

  function polyline(values: number[], color: string, fill: string) {
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const fillPts = [
      `${x(0)},${y(0)}`,
      ...values.map((v, i) => `${x(i)},${y(v)}`),
      `${x(values.length - 1)},${y(0)}`,
    ].join(' ');
    return (
      <>
        <polygon points={fillPts} fill={fill} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={color} />
        ))}
      </>
    );
  }

  // Y-axis labels
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: maxVal * f, y: y(maxVal * f) }));

  // X-axis labels (show max 6)
  const step = Math.max(1, Math.ceil(points.length / 6));
  const xLabels = points
    .map((p, i) => ({ label: p.period.length > 7 ? p.period.slice(5) : p.period, i }))
    .filter((_, i) => i % step === 0 || i === points.length - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
        {/* Grid */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
              stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
            <text x={PAD.left - 6} y={t.y} textAnchor="end" dominantBaseline="middle"
              fontSize="9" fill="currentColor" fillOpacity="0.5">
              {formatCurrency(t.v, locale, { withSymbol: false })}
            </text>
          </g>
        ))}

        {/* Areas + lines */}
        {polyline(
          points.map((p) => p.expenses),
          '#ef4444',
          'rgba(239,68,68,0.08)',
        )}
        {polyline(
          points.map((p) => p.income),
          '#22c55e',
          'rgba(34,197,94,0.12)',
        )}

        {/* X labels */}
        {xLabels.map(({ label, i }) => (
          <text key={i} x={x(i)} y={H - PAD.bottom + 14} textAnchor="middle"
            fontSize="9" fill="currentColor" fillOpacity="0.5">
            {label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-green-500" />
          {t('legendIncome')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-red-500" />
          {t('legendExpenses')}
        </span>
      </div>
    </div>
  );
}

/* ── Date range / grain controls ── */
function Controls({
  from, to, grain,
  onChange,
}: {
  from: string;
  to: string;
  grain: 'day' | 'week' | 'month';
  onChange: (f: string, t: string, g: 'day' | 'week' | 'month') => void;
}) {
  const t = useTranslations('incubator.analytics');
  const GRAINS: { value: 'day' | 'week' | 'month'; label: string }[] = [
    { value: 'day',   label: t('grainDaily') },
    { value: 'week',  label: t('grainWeekly') },
    { value: 'month', label: t('grainMonthly') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to, grain)}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <span className="text-muted-foreground">→</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value, grain)}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex overflow-hidden rounded-md border border-input">
        {GRAINS.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => onChange(from, to, g.value)}
            className={[
              'px-3 py-1 text-xs transition-colors',
              grain === g.value
                ? 'bg-primary text-primary-foreground font-medium'
                : 'hover:bg-muted text-muted-foreground',
            ].join(' ')}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ── */
export function AnalyticsDashboard() {
  const locale    = useLocale() as Locale;
  const t         = useTranslations('incubator.analytics');
  const today     = new Date().toISOString().slice(0, 10);
  const yearStart = today.slice(0, 4) + '-01-01';

  const [from, setFrom]       = useState(yearStart);
  const [to, setTo]           = useState(today);
  const [grain, setGrain]     = useState<'day' | 'week' | 'month'>('month');
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function fetchData(f: string, t: string, g: string) {
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/incubator/analytics?from=${f}&to=${t}&grain=${g}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Failed to load analytics');
      setData(await res.json() as AnalyticsData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error loading analytics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchData(from, to, grain); }, []);

  function handleChange(f: string, t: string, g: 'day' | 'week' | 'month') {
    setFrom(f); setTo(t); setGrain(g);
    void fetchData(f, t, g);
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t('financialOverview')}</h2>
        <Controls from={from} to={to} grain={grain} onChange={handleChange} />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          {t('loadingAnalytics')}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI row */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              label={t('totalIncome')}
              value={formatCurrency(data.totalIncome, locale)}
              icon={TrendingUp}
              positive
            />
            <KpiCard
              label={t('totalExpenses')}
              value={formatCurrency(data.totalExpenses, locale)}
              icon={TrendingDown}
              positive={false}
            />
            <KpiCard
              label={t('netProfit')}
              value={formatCurrency(data.netProfit, locale)}
              icon={Wallet}
              positive={data.netProfit >= 0}
            />
            <KpiCard
              label={t('mrr')}
              value={formatCurrency(data.mrr, locale)}
              icon={BarChart2}
            />
            <KpiCard
              label={t('platformBookings')}
              value={String(data.bookingCount)}
              sub={t('inSelectedPeriod')}
              icon={Calendar}
            />
          </div>

          {/* Charts row */}
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Trend chart */}
            <Card className="lg:col-span-3">
              <div className="border-b border-border/60 px-4 py-3">
                <p className="text-sm font-medium">{t('incomeVsExpenses')}</p>
              </div>
              <CardContent className="p-4">
                <TrendChart points={data.trend} locale={locale} />
              </CardContent>
            </Card>

            {/* Revenue by service */}
            <Card className="lg:col-span-2">
              <div className="border-b border-border/60 px-4 py-3">
                <p className="text-sm font-medium">{t('revenueByService')}</p>
              </div>
              <CardContent className="p-4">
                <ServiceBars items={data.revenueByService} locale={locale} />
              </CardContent>
            </Card>
          </div>

          {/* Trend table */}
          {data.trend.length > 0 && (
            <Card>
              <div className="border-b border-border/60 px-4 py-3">
                <p className="text-sm font-medium">{t('periodBreakdown')}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/60">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t('colPeriod')}</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">{t('colIncome')}</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">{t('colExpenses')}</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">{t('colNet')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.map((p) => (
                      <tr key={p.period} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-2.5 font-medium">{p.period}</td>
                        <td className="px-4 py-2.5 text-right text-green-600 dark:text-green-400">
                          {p.income > 0 ? `+${formatCurrency(p.income, locale)}` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-destructive">
                          {p.expenses > 0 ? `-${formatCurrency(p.expenses, locale)}` : '—'}
                        </td>
                        <td className={[
                          'px-4 py-2.5 text-right font-medium',
                          p.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive',
                        ].join(' ')}>
                          {formatCurrency(p.net, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
