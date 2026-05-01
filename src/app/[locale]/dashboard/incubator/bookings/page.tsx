import { setRequestLocale, getLocale } from 'next-intl/server';
import { Calendar, Briefcase, Building2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { BookingStatusBadge } from '@/components/features/booking/booking-status-badge';
import { StatCard } from '@/components/shared/stat-card';
import { requireRole } from '@/lib/auth-guards';
import { formatCurrency, formatDate } from '@/lib/format';
import { demoIncubatorBookings } from '@/lib/demo-data';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

const kindIcon: Record<'SPACE' | 'PROGRAM' | 'EVENT', React.ReactNode> = {
  SPACE: <Building2 className="size-3.5" />,
  PROGRAM: <Briefcase className="size-3.5" />,
  EVENT: <Calendar className="size-3.5" />,
};

const kindLabel: Record<'SPACE' | 'PROGRAM' | 'EVENT', string> = {
  SPACE: 'Space',
  PROGRAM: 'Program',
  EVENT: 'Event',
};

export default async function IncubatorBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = (await getLocale()) as Locale;
  await requireRole(['INCUBATOR']);

  const rows = demoIncubatorBookings;
  const upcoming = rows.filter((r) => r.status === 'CONFIRMED' || r.status === 'PENDING').length;
  const pending = rows.filter((r) => r.status === 'PENDING').length;
  const grossThisMonth = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Bookings"
        subtitle="People who've booked your spaces, programs, and events."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Upcoming" value={upcoming} icon={Calendar} />
        <StatCard label="Pending review" value={pending} icon={Briefcase} hint="Need confirmation" />
        <StatCard
          label="Gross this month"
          value={formatCurrency(grossThisMonth, lang)}
          icon={Building2}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title="No bookings yet"
              description="When customers book your spaces or programs, they'll show up here."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.bookedBy}</div>
                        <div className="text-xs text-muted-foreground">{b.bookedByEmail}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{b.itemName}</div>
                        <Badge variant="outline" className="mt-1 gap-1">
                          {kindIcon[b.itemKind]}
                          {kindLabel[b.itemKind]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(b.startsAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">
                        {b.amount === 0 ? (
                          <span className="text-muted-foreground">Free</span>
                        ) : (
                          formatCurrency(b.amount, lang)
                        )}
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
        Showing demo data — real bookings will appear here once the booking flow ships.
      </p>
    </div>
  );
}
