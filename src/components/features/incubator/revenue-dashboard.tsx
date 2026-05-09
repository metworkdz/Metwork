'use client';

/**
 * Revenue dashboard — real data from /api/incubator/revenue.
 * Shows YTD/MTD stats and monthly breakdown table.
 */
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
  const { totals, mtd, buckets, incubator } = data;
  const maxGross = Math.max(...buckets.map((b) => b.gross), 1);
  const commissionPct = Math.round(incubator.commissionRate * 100);

  return (
    <div className="space-y-6">
      {/* MTD stats */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">This month</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Gross (MTD)" value={fmt(mtd.gross)} icon={TrendingUp} />
          <StatCard label="Net (MTD)" value={fmt(mtd.net)} hint="After commission" icon={Wallet} />
          <StatCard
            label="Commission"
            value={fmt(mtd.commission)}
            hint={incubator.subscriptionTier === 'COMMISSION'
              ? `${commissionPct}% of gross`
              : 'Flat plan — 0%'}
            icon={Percent}
          />
          <StatCard label="Bookings (MTD)" value={mtd.bookings} icon={ReceiptText} />
        </div>
      </div>

      {/* YTD stats */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Year to date</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Gross (YTD)" value={fmt(totals.gross)} icon={TrendingUp} />
          <StatCard label="Net (YTD)" value={fmt(totals.net)} hint="After commission" icon={Wallet} />
          <StatCard label="Platform commission" value={fmt(totals.commission)} icon={Percent} />
          <StatCard label="Total bookings" value={totals.bookings} icon={ReceiptText} />
        </div>
      </div>

      {/* Breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {buckets.length === 0 ? (
            <InlineEmptyState
              title="No revenue yet"
              description="Revenue will appear here once customers start booking your spaces and programs."
              icon={<TrendingUp className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Volume</TableHead>
                    <TableHead className="text-end">Gross</TableHead>
                    <TableHead className="text-end">Commission</TableHead>
                    <TableHead className="text-end">Net</TableHead>
                    <TableHead className="text-end">Bookings</TableHead>
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
        Plan: <strong>{incubator.subscriptionTier}</strong>{' '}
        {incubator.subscriptionTier === 'COMMISSION'
          ? `— Metwork takes ${commissionPct}% of each booking`
          : '— flat rate, you keep 100% of bookings'}
      </p>
    </div>
  );
}
