import { setRequestLocale, getLocale } from 'next-intl/server';
import { Calendar, Plus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { BookingStatusBadge } from '@/components/features/booking/booking-status-badge';
import { requireRole } from '@/lib/auth-guards';
import { formatCurrency, formatDate } from '@/lib/format';
import { demoEntrepreneurBookingsDisplay } from '@/lib/demo-data';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = (await getLocale()) as Locale;
  await requireRole(['ENTREPRENEUR']);

  const rows = demoEntrepreneurBookingsDisplay;
  const upcoming = rows.filter((b) => b.status === 'CONFIRMED' || b.status === 'PENDING').length;
  const past = rows.filter((b) => b.status === 'COMPLETED' || b.status === 'CANCELLED').length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Bookings"
        subtitle="Spaces and programs you've reserved."
        action={
          <Button asChild size="sm">
            <Link href="/spaces">
              <Plus />
              Book a space
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Upcoming" value={upcoming} accent="primary" />
        <SummaryTile label="Past" value={past} accent="muted" />
        <SummaryTile label="Total spent" value={formatCurrency(rows.reduce((s, b) => s + b.totalAmount, 0), lang)} accent="muted" />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title="No bookings yet"
              description="Browse coworking spaces, training rooms, and programs."
              icon={<Calendar className="size-5 text-muted-foreground" />}
              action={
                <Button asChild size="sm">
                  <Link href="/spaces">Browse spaces</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div>{b.vendor}</div>
                        <div className="text-xs">{b.city}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(b.startsAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={b.kind === 'PROGRAM' ? 'info' : 'outline'}>
                          {b.kind === 'PROGRAM' ? 'Program' : 'Space'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">
                        {formatCurrency(b.totalAmount, lang)}
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

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: 'primary' | 'muted';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={accent === 'primary' ? 'mt-2 text-2xl font-semibold text-primary-700' : 'mt-2 text-2xl font-semibold'}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
