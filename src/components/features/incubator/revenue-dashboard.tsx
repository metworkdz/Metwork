'use client';

/**
 * Revenue dashboard — real data from /api/incubator/revenue.
 * Shows YTD/MTD stats and monthly breakdown table.
 */
import { useTranslations } from 'next-intl';
import { TrendingUp, Wallet, Percent, ReceiptText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/shared/stat-card';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';

interface RevenueBucket {
  month: string;
  gross: number;
  commission: number;
  net: number;
  bookings: number;
}

interface RevenueData {
  incubator: {
    name: string;
    subscriptionTier: 'COMMISSION' | 'FLAT';
    commissionRate: number;
  };
  totals: { gross: number; commission: number; net: number; bookings: number };
  mtd: { gross: number; commission: number; net: number; bookings: number };
  buckets: RevenueBucket[];
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function fmt(n: number): string {
  return `${n.toLocaleString()} DZD`;
}

interface Props {
  data: RevenueData;
}

export function RevenueDashboard({ data }: Props) {
  const t = useTranslations('incubator.revenueDashboard');
  const { totals, mtd, buckets, incubator } = data;
  const maxGross = Math.max(...buckets.map((b) => b.gross), 1);
  const commissionPct = Math.round(incubator.commissionRate * 100);

  return (
    <div className="space-y-6">
      {/* MTD stats */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">{t('thisMonth')}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t('grossMtd')} value={fmt(mtd.gross)} icon={TrendingUp} />
          <StatCard label={t('netMtd')} value={fmt(mtd.net)} hint={t('hintAfterCommission')} icon={Wallet} />
          <StatCard
            label={t('commission')}
            value={fmt(mtd.commission)}
            hint={incubator.subscriptionTier === 'COMMISSION'
              ? t('hintCommissionPct', { pct: commissionPct })
              : t('hintFlatPlan')}
            icon={Percent}
          />
          <StatCard label={t('bookingsMtd')} value={mtd.bookings} icon={ReceiptText} />
        </div>
      </div>

      {/* YTD stats */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">{t('yearToDate')}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t('grossYtd')} value={fmt(totals.gross)} icon={TrendingUp} />
          <StatCard label={t('netYtd')} value={fmt(totals.net)} hint={t('hintAfterCommission')} icon={Wallet} />
          <StatCard label={t('platformCommission')} value={fmt(totals.commission)} icon={Percent} />
          <StatCard label={t('totalBookings')} value={totals.bookings} icon={ReceiptText} />
        </div>
      </div>

      {/* Breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('monthlyBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {buckets.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
              icon={<TrendingUp className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colMonth')}</TableHead>
                    <TableHead>{t('colVolume')}</TableHead>
                    <TableHead className="text-end">{t('colGross')}</TableHead>
                    <TableHead className="text-end">{t('colCommission')}</TableHead>
                    <TableHead className="text-end">{t('colNet')}</TableHead>
                    <TableHead className="text-end">{t('colBookings')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.slice().reverse().map((b) => (
                    <TableRow key={b.month}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {monthLabel(b.month)}
                      </TableCell>
                      <TableCell>
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary-500"
                            style={{ width: `${Math.round((b.gross / maxGross) * 100)}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(b.gross)}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">
                        {b.commission > 0 ? `− ${fmt(b.commission)}` : '—'}
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-semibold">{fmt(b.net)}</TableCell>
                      <TableCell className="text-end">
                        <Badge variant="outline">{b.bookings}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t('planLabel')}: <strong>{incubator.subscriptionTier}</strong>{' '}
        {incubator.subscriptionTier === 'COMMISSION'
          ? t('planCommissionDetail', { pct: commissionPct })
          : t('planFlatDetail')}
      </p>
    </div>
  );
}
