'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Briefcase, Calendar, CheckCircle2, XCircle, ReceiptText, Wifi, WifiOff, Banknote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { StatCard } from '@/components/shared/stat-card';
import { ReceiptModal } from './receipt-modal';
import { ManualBookingForm } from './manual-booking-form';
import type { BookingRecord, IncubatorRecord, IncubatorSpaceRecord, IncubatorProgramRecord } from '@/server/db/store';

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger' | 'default' | 'outline'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
  COMPLETED: 'default',
  REFUNDED: 'outline',
};

const KIND_ICON: Record<string, React.ReactNode> = {
  SPACE: <Building2 className="size-3.5" />,
  PROGRAM: <Briefcase className="size-3.5" />,
  EVENT: <Calendar className="size-3.5" />,
};

interface Props {
  initial: BookingWithCustomer[];
  incubator: IncubatorRecord | null;
  spaces: IncubatorSpaceRecord[];
  programs: IncubatorProgramRecord[];
}

type SourceFilter = 'ALL' | 'online' | 'offline';
type StatusFilter = 'ALL' | 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export function BookingsManager({ initial, incubator, spaces, programs }: Props) {
  const t = useTranslations('incubator.bookings');
  const [bookings, setBookings] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptBookingId, setReceiptBookingId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  async function updateStatus(id: string, status: 'CONFIRMED' | 'CANCELLED') {
    setBusy(id);
    try {
      const res = await fetch(`/api/incubator/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      const data = await res.json() as { booking: BookingWithCustomer };
      setBookings((prev) => prev.map((b) => b.id === id ? data.booking : b));
    } finally {
      setBusy(null);
    }
  }

  async function markCashPaid(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/incubator/bookings/${id}/mark-cash-paid`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as { booking: BookingWithCustomer };
      setBookings((prev) => prev.map((b) => b.id === id ? data.booking : b));
    } finally {
      setBusy(null);
    }
  }

  function handleManualCreated(booking: BookingWithCustomer) {
    setBookings((prev) => [booking, ...prev]);
  }

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      if (sourceFilter !== 'ALL') {
        const src = b.source ?? 'online';
        if (src !== sourceFilter) return false;
      }
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      return true;
    });
  }, [bookings, sourceFilter, statusFilter]);

  const pending = bookings.filter((b) => b.status === 'PENDING').length;
  const confirmed = bookings.filter((b) => b.status === 'CONFIRMED').length;
  const gross = bookings
    .filter((b) => b.status !== 'CANCELLED' && b.status !== 'REFUNDED')
    .reduce((s, b) => s + b.totalAmount, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statPendingReview')} value={pending} icon={Calendar} hint={t('statPendingHint')} />
        <StatCard label={t('statConfirmed')} value={confirmed} icon={CheckCircle2} />
        <StatCard label={t('statTotalRevenue')} value={`${gross.toLocaleString()} DZD`} icon={ReceiptText} hint={t('statTotalRevenueHint')} />
      </div>

      {/* Filters + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filterAllSources')}</SelectItem>
            <SelectItem value="online">{t('filterOnlineOnly')}</SelectItem>
            <SelectItem value="offline">{t('filterOfflineOnly')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filterAllStatuses')}</SelectItem>
            <SelectItem value="PENDING">{t('filterPending')}</SelectItem>
            <SelectItem value="CONFIRMED">{t('filterConfirmed')}</SelectItem>
            <SelectItem value="CANCELLED">{t('filterCancelled')}</SelectItem>
            <SelectItem value="COMPLETED">{t('filterCompleted')}</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto">
          {incubator && (
            <ManualBookingForm
              spaces={spaces}
              programs={programs}
              onCreated={handleManualCreated}
            />
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title={bookings.length === 0 ? t('emptyTitle') : t('emptyTitleFiltered')}
              description={bookings.length === 0 ? t('emptyDescription') : t('emptyDescriptionFiltered')}
              icon={<Calendar className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCustomer')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-end">{t('colAmount')}</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => {
                    const isOffline = b.source === 'offline';
                    const isCashDeposit = b.paymentMethod === 'card' && b.paymentMode === 'CASH_DEPOSIT';
                    const awaitingCash = isCashDeposit && b.status === 'CONFIRMED' && b.paymentStatus === 'AWAITING_CASH';
                    const cashCollected = isCashDeposit && b.paymentStatus === 'PAID';
                    const balanceDue = b.cashRemainingAmount ?? 0;
                    return (
                      <TableRow key={b.id}>
                        <TableCell>
                          <div className="font-medium">{b.customerName}</div>
                          <div className="text-xs text-muted-foreground">{b.customerEmail || b.customerPhone}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{b.itemName}</div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <Badge variant="outline" className="gap-1 text-xs">
                              {KIND_ICON[b.itemKind]}
                              {b.itemKind.charAt(0) + b.itemKind.slice(1).toLowerCase()}
                            </Badge>
                            <Badge
                              variant={isOffline ? 'warning' : 'outline'}
                              className="gap-1 text-xs"
                              title={isOffline ? 'Manual / offline booking' : 'Online booking'}
                            >
                              {isOffline
                                ? <><WifiOff className="size-3" /> {t('badgeOffline')}</>
                                : <><Wifi className="size-3" /> {t('badgeOnline')}</>
                              }
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(b.startsAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[b.status] ?? 'outline'}>
                            {b.status.charAt(0) + b.status.slice(1).toLowerCase()}
                          </Badge>
                          {awaitingCash && (
                            <Badge variant="warning" className="mt-1 flex w-fit items-center gap-1 text-xs">
                              <Banknote className="size-3" /> {t('awaitingCash')}
                            </Badge>
                          )}
                          {cashCollected && (
                            <Badge variant="success" className="mt-1 flex w-fit items-center gap-1 text-xs">
                              <Banknote className="size-3" /> {t('cashCollected')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums font-medium text-sm">
                          {b.totalAmount === 0 ? (
                            <span className="text-muted-foreground">{t('free')}</span>
                          ) : (
                            `${b.totalAmount.toLocaleString()} DZD`
                          )}
                          {isCashDeposit && balanceDue > 0 && (
                            <div className={`mt-0.5 text-xs font-normal ${awaitingCash ? 'text-amber-600' : 'text-muted-foreground'}`}>
                              {awaitingCash
                                ? t('balanceDue', { amount: `${balanceDue.toLocaleString()} DZD` })
                                : t('balanceCollected', { amount: `${balanceDue.toLocaleString()} DZD` })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">
                            {b.status === 'PENDING' && (
                              <>
                                <Button size="icon" variant="ghost" title="Confirm"
                                  className="text-green-600 hover:text-green-700"
                                  disabled={busy === b.id}
                                  onClick={() => updateStatus(b.id, 'CONFIRMED')}>
                                  <CheckCircle2 className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" title="Cancel"
                                  className="text-destructive hover:text-destructive"
                                  disabled={busy === b.id}
                                  onClick={() => updateStatus(b.id, 'CANCELLED')}>
                                  <XCircle className="size-4" />
                                </Button>
                              </>
                            )}
                            {awaitingCash && (
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs"
                                title={t('markCashPaid')}
                                disabled={busy === b.id}
                                onClick={() => markCashPaid(b.id)}>
                                <Banknote className="size-3.5" /> {t('markCashPaid')}
                              </Button>
                            )}
                            {b.status !== 'PENDING' && b.status !== 'CANCELLED' && (
                              <Button size="icon" variant="ghost" title="View receipt"
                                onClick={() => setReceiptBookingId(b.id)}>
                                <ReceiptText className="size-4" />
                              </Button>
                            )}
                          </div>
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

      {receiptBookingId && (
        <ReceiptModal
          bookingId={receiptBookingId}
          onClose={() => setReceiptBookingId(null)}
        />
      )}
    </>
  );
}
