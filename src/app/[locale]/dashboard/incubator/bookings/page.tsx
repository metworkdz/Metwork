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
import { listingHasClockTime } from '@/lib/booking-when';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { BookingStatusBadge } from '@/components/features/booking/booking-status-badge';
import { StatCard } from '@/components/shared/stat-card';
import { ManualBookingDialog } from '@/components/features/incubator/manual-booking-dialog';
import { CancelUnpaidButton } from '@/components/features/incubator/cancel-unpaid-button';
import { RequestApprovalButtons } from '@/components/features/incubator/request-approval-buttons';
import { BookingRowActions } from '@/components/features/incubator/booking-row-actions';
import { DownloadContractButton } from '@/components/features/incubator/download-contract-button';
import { MarkCashPaidButton } from '@/components/features/incubator/mark-cash-paid-button';
import { applicableTemplates } from '@/server/contracts/service';
import { requireRole } from '@/lib/auth-guards';
import { formatCurrency, formatDate } from '@/lib/format';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { bookingCountsAsRevenue } from '@/server/bookings/status';
import { db } from '@/server/db/store';
import type { BookingStatus } from '@/types/domain';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

const kindIcon: Record<'SPACE' | 'PROGRAM' | 'EVENT', React.ReactNode> = {
  SPACE:   <Building2 className="size-3.5" />,
  PROGRAM: <Briefcase className="size-3.5" />,
  EVENT:   <Calendar className="size-3.5" />,
};

// kindLabel is built inside the component using t() to enable translations

interface IncubatorBookingRow {
  id: string;
  itemKind: 'SPACE' | 'PROGRAM' | 'EVENT';
  itemName: string;
  status: BookingStatus;
  totalAmount: number;
  paymentMethod: 'wallet' | 'manual' | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  /** Carried through so a host can actually call somebody about a booking. */
  customerPhone: string;
  // Manual/offline bookings can be edited or deleted by the incubator.
  isManual: boolean;
  /** Cash still owed, and how much has already been handed over. */
  balanceDue: number;
  paidAlready: number;
  paidAtOffice: boolean;
  awaitingCash: boolean;
  unit: 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
  notes: string;
  // Applicable contract templates for this booking (SPACE bookings only).
  contractTemplates: { id: string; name: string }[];
}

export default async function IncubatorBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t    = await getTranslations('pages.dashboard.incubator.bookings');
  // The cash-balance strings live with the other booking-money copy.
  const tb   = await getTranslations('incubator.bookings');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['INCUBATOR']);

  const kindLabel: Record<'SPACE' | 'PROGRAM' | 'EVENT', string> = {
    SPACE:   t('kindSpace'),
    PROGRAM: t('kindProgram'),
    EVENT:   t('kindEvent'),
  };

  const inc  = await findIncubatorByUserEmail(user.email);
  let rows: IncubatorBookingRow[] = [];

  // Spaces belonging to this incubator (for manual booking dialog)
  const mySpaces = inc
    ? (await db.read()).spaces.filter((s) => s.incubatorId === inc.id && s.isActive)
    : [];

  if (inc) {
    const data = await db.read();

    const spaceIds   = new Set((data.spaces   ?? []).filter((s) => s.incubatorId === inc.id).map((s) => s.id));
    const programIds = new Set((data.programs ?? []).filter((p) => p.incubatorId === inc.id).map((p) => p.id));
    const eventIds   = new Set((data.events   ?? []).filter((e) => e.incubatorId === inc.id).map((e) => e.id));

    // Space category lookup + the incubator's contract templates, used to offer
    // a "Download contract" action per applicable SPACE booking.
    const spaceCategoryById = new Map((data.spaces ?? []).map((s) => [s.id, s.category]));
    const myTemplates = (data.contractTemplates ?? []).filter((c) => c.incubatorId === inc.id);

    const relevant = data.bookings.filter((b) => {
      if (b.itemKind === 'SPACE'   && spaceIds.has(b.itemId))   return true;
      if (b.itemKind === 'PROGRAM' && programIds.has(b.itemId)) return true;
      if (b.itemKind === 'EVENT'   && eventIds.has(b.itemId))   return true;
      return false;
    });

    const userMap = new Map(data.users.map((u) => [u.id, { fullName: u.fullName, email: u.email, phone: u.phone }]));

    rows = relevant
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => {
        const customer = b.userId ? userMap.get(b.userId) : undefined;
        return {
          id:            b.id,
          itemKind:      b.itemKind as 'SPACE' | 'PROGRAM' | 'EVENT',
          itemName:      b.itemName,
          status:        b.status as BookingStatus,
          totalAmount:   b.totalAmount,
          paymentMethod: (b.paymentMethod ?? null) as 'wallet' | 'manual' | null,
          startsAt:      b.startsAt,
          endsAt:        b.endsAt,
          createdAt:     b.createdAt,
          customerName:  customer?.fullName ?? b.clientName ?? 'Unknown',
          customerEmail: customer?.email    ?? b.clientEmail ?? '',
          customerPhone: customer?.phone    ?? b.clientPhone ?? '',
          isManual:      b.source === 'offline' || b.paymentMethod === 'manual',
          // A cash leg exists on a card deposit AND on a desk sale. The money
          // already in hand comes from a different field on each, because one
          // went through a card rail and the other did not.
          balanceDue:    b.paymentMode === 'CASH_DEPOSIT' ? (b.cashRemainingAmount ?? 0) : 0,
          paidAlready:   (b.cashDepositPaidAmount ?? 0) > 0
                           ? (b.cashDepositPaidAmount ?? 0)
                           : (b.onlineChargeAmount ?? b.onlinePaidAmount ?? 0),
          paidAtOffice:  (b.cashDepositPaidAmount ?? 0) > 0,
          awaitingCash:  b.paymentMode === 'CASH_DEPOSIT' &&
                         b.status === 'CONFIRMED' &&
                         b.paymentStatus === 'AWAITING_CASH',
          unit:          (b.unit ?? 'DAY') as 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH',
          notes:         b.notes ?? '',
          contractTemplates: b.itemKind === 'SPACE'
            ? applicableTemplates(myTemplates, spaceCategoryById.get(b.itemId) ?? null).map((c) => ({ id: c.id, name: c.name }))
            : [],
        };
      });
  }

  const upcoming        = rows.filter((r) => r.status === 'CONFIRMED' || r.status === 'PENDING').length;
  // APPROVED_UNPAID request bookings are, like PENDING_PAYMENT intents, awaiting
  // the client's payment — surface them under the same stat.
  const awaitingPayment = rows.filter((r) => r.status === 'PENDING_PAYMENT' || r.status === 'APPROVED_UNPAID').length;
  const thisMonth       = new Date().toISOString().slice(0, 7);
  // This-month payments: only settled/paid bookings count. Awaiting-payment
  // (PENDING_PAYMENT) intents are excluded via the shared rule — they're surfaced
  // separately by the "awaiting payment" stat above.
  const grossThisMonth  = rows
    .filter((r) => r.createdAt?.startsWith(thisMonth) && bookingCountsAsRevenue(r))
    .reduce((s, r) => s + r.totalAmount, 0);

  // A clock only for listings that have one. Programs and events store a noon
  // anchor rather than a chosen time, so printing hh:mm showed the incubator a
  // start time nobody entered — the same invented "11:00" the client saw.
  const fmtRange = (startsAt: string, endsAt: string, b?: { itemKind?: string | null; startsAtHasClockTime?: boolean }) => {
    const opts = listingHasClockTime(b)
      ? ({ dateStyle: 'short', timeStyle: 'short' } as const)
      : ({ dateStyle: 'short' } as const);
    return { start: formatDate(startsAt, lang, opts), end: formatDate(endsAt, lang, opts) };
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('title')}
        subtitle={t('subtitleFull')}
        action={
          mySpaces.length > 0 ? (
            <ManualBookingDialog
              spaces={mySpaces.map((s) => ({
                id: s.id,
                name: s.name,
                openingTime: s.openingTime ?? '09:00',
                closingTime: s.closingTime ?? '18:00',
                category: s.category,
                deskNames: s.deskNames ?? [],
              }))}
            />
          ) : undefined
        }
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
            <>
            {/* Desktop: the full table. Below lg it becomes a card list —
                this table is eight columns wide, and the actions (collect the
                cash, cancel an unpaid hold) sit in the LAST one. On a phone
                that put the one thing a host does at the front desk behind a
                horizontal scroll nobody discovers. */}
            <div className="hidden overflow-x-auto lg:block">
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
                    <TableHead className="w-36 text-end">{t('colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => {
                    const { start, end } = fmtRange(b.startsAt, b.endsAt, b);
                    return (
                      <TableRow key={b.id}>
                        <TableCell>
                          <div className="font-medium">{b.customerName}</div>
                          <div className="text-xs text-muted-foreground">{b.customerEmail}</div>
                          {b.customerPhone && (
                            <a href={`tel:${b.customerPhone.replace(/\s/g, '')}`} dir="ltr"
                              className="text-xs text-primary hover:underline">
                              {b.customerPhone}
                            </a>
                          )}
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
                          {/* The operational lines: what is in hand, and what
                              still has to be collected on the day. */}
                          {b.balanceDue > 0 && (
                            <>
                              {/* Nothing paid yet (a desk sale with no deposit)
                                  reads better as silence than as "paid: 0". */}
                              {b.paidAlready > 0 && (
                                <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                                  {b.paidAtOffice
                                    ? tb('paidAtOffice', { amount: formatCurrency(b.paidAlready, lang) })
                                    : tb('paidOnline', { amount: formatCurrency(b.paidAlready, lang) })}
                                </div>
                              )}
                              <div className={`text-xs font-normal ${b.awaitingCash ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                {b.awaitingCash
                                  ? tb('balanceDue', { amount: formatCurrency(b.balanceDue, lang) })
                                  : tb('balanceCollected', { amount: formatCurrency(b.balanceDue, lang) })}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            {b.itemKind === 'SPACE' && (
                              <DownloadContractButton bookingId={b.id} templates={b.contractTemplates} />
                            )}
                            {b.awaitingCash && <MarkCashPaidButton bookingId={b.id} />}
                            {b.status === 'PENDING_PAYMENT' && (
                              <CancelUnpaidButton bookingId={b.id} />
                            )}
                            {b.status === 'AWAITING_APPROVAL' && (
                              <RequestApprovalButtons bookingId={b.id} />
                            )}
                            {b.isManual && (
                              <BookingRowActions
                                booking={{
                                  id:          b.id,
                                  itemName:    b.itemName,
                                  startsAt:    b.startsAt,
                                  endsAt:      b.endsAt,
                                  unit:        b.unit,
                                  totalAmount: b.totalAmount,
                                  clientName:  b.customerName,
                                  clientEmail: b.customerEmail,
                                  notes:       b.notes,
                                }}
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="space-y-3 lg:hidden">
              {rows.map((b) => {
                const { start, end } = fmtRange(b.startsAt, b.endsAt, b);
                return (
                  <div key={b.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{b.customerName}</p>
                        {b.customerPhone && (
                          <a href={`tel:${b.customerPhone.replace(/\s/g, '')}`} dir="ltr"
                            className="block truncate text-xs text-primary hover:underline">
                            {b.customerPhone}
                          </a>
                        )}
                        {b.customerEmail && (
                          <p className="truncate text-xs text-muted-foreground">{b.customerEmail}</p>
                        )}
                      </div>
                      <div className="shrink-0"><BookingStatusBadge status={b.status} /></div>
                    </div>

                    <div className="mt-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{b.itemName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {start}{end && end !== start ? ` → ${end}` : ''}
                        </p>
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {b.paymentMethod === 'manual' ? (
                            <><Banknote className="size-3.5" /> {t('paymentCash')}</>
                          ) : (
                            <><CreditCard className="size-3.5" /> {t('paymentOnline')}</>
                          )}
                        </span>
                      </div>
                      <div className="shrink-0 text-end tabular-nums">
                        <p className="font-medium">
                          {b.totalAmount === 0
                            ? <span className="text-muted-foreground">{t('free')}</span>
                            : formatCurrency(b.totalAmount, lang)}
                        </p>
                        {b.balanceDue > 0 && (
                          <>
                            {b.paidAlready > 0 && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {b.paidAtOffice
                                  ? tb('paidAtOffice', { amount: formatCurrency(b.paidAlready, lang) })
                                  : tb('paidOnline', { amount: formatCurrency(b.paidAlready, lang) })}
                              </p>
                            )}
                            <p className={`text-xs ${b.awaitingCash ? 'text-amber-600' : 'text-muted-foreground'}`}>
                              {b.awaitingCash
                                ? tb('balanceDue', { amount: formatCurrency(b.balanceDue, lang) })
                                : tb('balanceCollected', { amount: formatCurrency(b.balanceDue, lang) })}
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    {(b.awaitingCash || b.status === 'PENDING_PAYMENT' ||
                      b.status === 'AWAITING_APPROVAL' || b.isManual ||
                      b.itemKind === 'SPACE') && (
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
                        {b.itemKind === 'SPACE' && (
                          <DownloadContractButton bookingId={b.id} templates={b.contractTemplates} />
                        )}
                        {b.awaitingCash && <MarkCashPaidButton bookingId={b.id} />}
                        {b.status === 'PENDING_PAYMENT' && <CancelUnpaidButton bookingId={b.id} />}
                        {b.status === 'AWAITING_APPROVAL' && <RequestApprovalButtons bookingId={b.id} />}
                        {b.isManual && (
                          <BookingRowActions
                            booking={{
                              id: b.id, itemName: b.itemName, startsAt: b.startsAt,
                              endsAt: b.endsAt, unit: b.unit, totalAmount: b.totalAmount,
                              clientName: b.customerName, clientEmail: b.customerEmail,
                              notes: b.notes,
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
