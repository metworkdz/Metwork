import { setRequestLocale, getLocale } from 'next-intl/server';
import { TrendingUp, ReceiptText, Wallet, Percent } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { requireRole } from '@/lib/auth-guards';
import { formatCurrency } from '@/lib/format';
import { demoRevenueBuckets } from '@/lib/demo-data';
import { platformCommissions } from '@/config/memberships';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function monthLabel(ym: string, locale: Locale) {
  const parts = ym.split('-');
  const yearStr = parts[0];
  const monthStr = parts[1];
  const year = yearStr ? Number(yearStr) : NaN;
  const month = monthStr ? Number(monthStr) : NaN;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return ym;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export default async function IncubatorRevenuePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = (await getLocale()) as Locale;
  await requireRole(['INCUBATOR']);

  const buckets = demoRevenueBuckets;
  const ytdGross = buckets.reduce((s, b) => s + b.gross, 0);
  const ytdNet = buckets.reduce((s, b) => s + b.net, 0);
  const ytdCommission = buckets.reduce((s, b) => s + b.commission, 0);
  const ytdBookings = buckets.reduce((s, b) => s + b.bookings, 0);
  const maxGross = Math.max(...buckets.map((b) => b.gross), 1);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Revenue"
        subtitle="What you've earned, less the platform commission."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="YTD gross"
          value={formatCurrency(ytdGross, lang)}
          icon={TrendingUp}
        />
        <StatCard
          label="YTD net"
          value={formatCurrency(ytdNet, lang)}
          hint="After platform commission"
          icon={Wallet}
        />
        <StatCard
          label="Platform commission"
          value={formatCurrency(ytdCommission, lang)}
          hint={`${Math.round(platformCommissions.incubatorBooking * 100)}% on bookings`}
          icon={Percent}
        />
        <StatCard label="YTD bookings" value={ytdBookings} icon={ReceiptText} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
                {buckets.map((b) => (
                  <TableRow key={b.month}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {monthLabel(b.month, lang)}
                    </TableCell>
                    <TableCell>
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary-500"
                          style={{ width: `${Math.round((b.gross / maxGross) * 100)}%` }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCurrency(b.gross, lang)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">
                      − {formatCurrency(b.commission, lang)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums font-semibold">
                      {formatCurrency(b.net, lang)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <Badge variant="outline">{b.bookings}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Showing demo data — real numbers will be sourced from the bookings ledger.
      </p>
    </div>
  );
}
