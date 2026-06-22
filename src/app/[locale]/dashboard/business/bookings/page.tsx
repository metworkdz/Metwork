import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Banknote, Calendar, Briefcase, Building2, CreditCard } from 'lucide-react';
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
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { db } from '@/server/db/store';
import type { BookingStatus } from '@/types/domain';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

// Businesses post programs & events (no spaces), so only those two kinds appear.
const kindIcon: Record<'PROGRAM' | 'EVENT', React.ReactNode> = {
  PROGRAM: <Briefcase className="size-3.5" />,
  EVENT:   <Calendar className="size-3.5" />,
};

interface BusinessBookingRow {
  id: string;
  itemKind: 'PROGRAM' | 'EVENT';
  itemName: string;
  status: BookingStatus;
  totalAmount: number;
  paymentMethod: 'wallet' | 'manual' | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
}

export default async function BusinessBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Reuse the incubator bookings translations — the table is identical.
  const t    = await getTranslations('pages.dashboard.incubator.bookings');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['BUSINESS']);

  const kindLabel: Record<'PROGRAM' | 'EVENT', string> = {
    PROGRAM: t('kindProgram'),
    EVENT:   t('kindEvent'),
  };

  const inc  = await findIncubatorByUserEmail(user.email);
  let rows: BusinessBookingRow[] = [];

  if (inc) {
    const data = await db.read();

    // Businesses own programs & events only — never spaces.
    const programIds = new Set((data.programs ?? []).filter((p) => p.incubatorId === inc.id).map((p) => p.id));
    const eventIds   = new Set((data.events   ?? []).filter((e) => e.incubatorId === inc.id).map((e) => e.id));

    const relevant = data.bookings.filter((b) => {
      if (b.itemKind === 'PROGRAM' && programIds.has(b.itemId)) return true;
      if (b.itemKind === 'EVENT'   && eventIds.has(b.itemId))   return true;
      return false;
    });

    const userMap = new Map(data.users.map((u) => [u.id, { fullName: u.fullName, email: u.email }]));

    rows = relevant
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => {
        const customer = b.userId ? userMap.get(b.userId) : undefined;
        return {
          id:            b.id,
          itemKind:      b.itemKind as 'PROGRAM' | 'EVENT',
          itemName:      b.itemName,
          status:        b.status as BookingStatus,
          totalAmount:   b.totalAmount,
          paymentMethod: (b.paymentMethod ?? null) as 'wallet' | 'manual' | null,
          startsAt:      b.startsAt,
          endsAt:        b.endsAt,
          createdAt:     b.createdAt,
          customerName:  customer?.fullName ?? 'Unknown',
          customerEmail: customer?.email    ?? '',
        };
      });
  }

  const upcoming        = rows.filter((r) => r.status === 'CONFIRMED' || r.status === 'PENDING').length;
  const awaitingPayment = rows.filter((r) => r.status === 'PENDING_PAYMENT').length;
  const thisMonth       = new Date().toISOString().slice(0, 7);
  const grossThisMonth  = rows
    .filter((r) => r.createdAt?.startsWith(thisMonth) && r.status !== 'CANCELLED' && r.status !== 'REFUNDED')
    .reduce((s, r) => s + r.totalAmount, 0);

  const fmtRange = (startsAt: string, endsAt: string) => {
    const start = formatDate(startsAt, lang, { dateStyle: 'short', timeStyle: 'short' });
    const end   = formatDate(endsAt,   lang, { dateStyle: 'short', timeStyle: 'short' });
    return { start, end };
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('title')}
        subtitle={t('subtitleFull')}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statUpcoming')} value={upcoming} icon={Calendar} />
        <StatCard
          label={t('statAwaiting')}
          value={awaitingPayment}
          icon={Banknote}
          hint={t('statAwaitingHint')}
        />
        <StatCard
          label={t('statGrossMonth')}
          value={formatCurrency(grossThisMonth, lang)}
          icon={Building2}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDesc')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCustomer')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead>{t('colFrom')}</TableHead>
                    <TableHead>{t('colTo')}</TableHead>
                    <TableHead>{t('colPayment')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-end">{t('colAmount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => {
                    const { start, end } = fmtRange(b.startsAt, b.endsAt);
                    return (
                      <TableRow key={b.id}>
                        <TableCell>
                          <div className="font-medium">{b.customerName}</div>
                          <div className="text-xs text-muted-foreground">{b.customerEmail}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{b.itemName}</div>
                          <Badge variant="outline" className="mt-1 gap-1">
                            {kindIcon[b.itemKind]}
                            {kindLabel[b.itemKind]}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {start}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {end}
                        </TableCell>
                        <TableCell>
                          {b.paymentMethod === 'manual' ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Banknote className="size-3.5" /> {t('paymentCash')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <CreditCard className="size-3.5" /> {t('paymentOnline')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <BookingStatusBadge status={b.status} />
                        </TableCell>
                        <TableCell className="text-end tabular-nums font-medium">
                          {b.totalAmount === 0 ? (
                            <span className="text-muted-foreground">{t('free')}</span>
                          ) : (
                            formatCurrency(b.totalAmount, lang)
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
