'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Briefcase, Calendar, CheckCircle2, XCircle, ReceiptText, Wifi, WifiOff, Banknote, Trash2, Undo2, Loader2 } from 'lucide-react';
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
import { DownloadContractButton } from './download-contract-button';
import { bookingCountsAsRevenue, bookingCanBeDeleted } from '@/server/bookings/status';
import type { BookingRecord, IncubatorRecord, IncubatorSpaceRecord, IncubatorProgramRecord } from '@/server/db/store';

type BookingWithCustomer = BookingRecord & {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Applicable contract templates for SPACE bookings (server-precomputed). */
  contractTemplates?: { id: string; name: string }[];
};

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger' | 'default' | 'outline'> = {
  PENDING: 'warning',
  PENDING_PAYMENT: 'warning',
  AWAITING_APPROVAL: 'outline',
  APPROVED_UNPAID: 'warning',
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
type StatusFilter = 'ALL' | 'PENDING' | 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'APPROVED_UNPAID' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export function BookingsManager({ initial, incubator, spaces, programs }: Props) {
  const t = useTranslations('incubator.bookings');
  const [bookings, setBookings] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [receiptBookingId, setReceiptBookingId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  /**
   * The Deleted tab is a separate fetch rather than a filter over `bookings`:
   * deleted rows never arrive in the page's payload, which is the point.
   */
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleted, setDeleted] = useState<BookingWithCustomer[] | null>(null);

  async function openDeleted() {
    setShowDeleted(true);
    if (deleted !== null) return;
    try {
      const res = await fetch('/api/incubator/bookings?view=deleted', { credentials: 'include' });
      const body = await res.json().catch(() => null);
      setDeleted(res.ok ? (body?.items ?? []) : []);
    } catch {
      setDeleted([]);
    }
  }

  async function removeBooking(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/incubator/bookings/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        alert(body?.error?.message ?? t('deleteFailed'));
        return;
      }
      const moved = bookings.find((b) => b.id === id);
      setBookings((prev) => prev.filter((b) => b.id !== id));
      // Keep the Deleted tab honest without refetching it.
      if (moved && deleted !== null) setDeleted((prev) => [moved, ...(prev ?? [])]);
    } finally {
      setBusy(null);
    }
  }

  async function restore(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/incubator/bookings/${id}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return;
      const moved = deleted?.find((b) => b.id === id);
      setDeleted((prev) => (prev ?? []).filter((b) => b.id !== id));
      if (moved) setBookings((prev) => [moved, ...prev]);
    } finally {
      setBusy(null);
    }
  }

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

  async function cancelUnpaid(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/incubator/bookings/${id}/cancel-unpaid`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as { booking: BookingRecord };
      setBookings((prev) => prev.map((b) => b.id === id ? { ...b, ...data.booking } : b));
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
    // The Deleted tab shows exactly what was deleted — the status and source
    // filters belong to the live list and would only hide rows confusingly.
    if (showDeleted) return deleted ?? [];
    return bookings.filter((b) => {
      if (sourceFilter !== 'ALL') {
        const src = b.source ?? 'online';
        if (src !== sourceFilter) return false;
      }
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      return true;
    });
  }, [bookings, sourceFilter, statusFilter, showDeleted, deleted]);

  const pending = bookings.filter((b) => b.status === 'PENDING').length;
  const confirmed = bookings.filter((b) => b.status === 'CONFIRMED').length;
  // Only settled/paid bookings count toward revenue (awaiting-payment excluded).
  const gross = bookings
    .filter((b) => bookingCountsAsRevenue(b))
    .reduce((s, b) => s + b.totalAmount, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statPendingReview')} value={pending} icon={Calendar} hint={t('statPendingHint')} />
        <StatCard label={t('statConfirmed')} value={confirmed} icon={CheckCircle2} />
        <StatCard label={t('statTotalRevenue')} value={`${gross.toLocaleString()} DZD`} icon={ReceiptText} hint={t('statTotalRevenueHint')} />
      </div>

      {/* Live list ↔ Deleted */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => setShowDeleted(false)}
          aria-pressed={!showDeleted}
          className={`flex min-h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
            showDeleted ? 'text-muted-foreground hover:text-foreground' : 'bg-background text-foreground shadow-sm'
          }`}
        >
          {t('tabActive')}
        </button>
        <button
          type="button"
          onClick={() => void openDeleted()}
          aria-pressed={showDeleted}
          className={`flex min-h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
            showDeleted ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Trash2 className="size-3.5" />
          {t('tabDeleted')}
          {deleted !== null && (
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{deleted.length}</span>
          )}
        </button>
      </div>

      {/* Filters + actions */}
      <div className={`flex flex-wrap items-center gap-2 ${showDeleted ? 'hidden' : ''}`}>
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
            <SelectItem value="PENDING_PAYMENT">{t('filterAwaitingPayment')}</SelectItem>
            <SelectItem value="AWAITING_APPROVAL">{t('filterAwaitingApproval')}</SelectItem>
            <SelectItem value="APPROVED_UNPAID">{t('filterApprovedUnpaid')}</SelectItem>
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
          {showDeleted && deleted === null ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
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
                    // Two shapes carry a cash balance: a card deposit paid
                    // online, and a desk sale recorded by the host. Keying on
                    // `card` alone hid the collect button on every walk-in —
                    // the server accepts both, so the UI must offer both.
                    const isCashDeposit =
                      (b.paymentMethod === 'card' || b.paymentMethod === 'manual') &&
                      b.paymentMode === 'CASH_DEPOSIT';
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
                            {b.status === 'PENDING_PAYMENT'
                              ? t('awaitingPayment')
                              : b.status === 'AWAITING_APPROVAL'
                              ? t('filterAwaitingApproval')
                              : b.status === 'APPROVED_UNPAID'
                              ? t('filterApprovedUnpaid')
                              : b.status.charAt(0) + b.status.slice(1).toLowerCase()}
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
                            <>
                              {/* Cash taken at the desk never went online —
                                  label it for what it was, and say nothing at
                                  all when nothing has been paid yet. */}
                              {((b.cashDepositPaidAmount ?? 0) > 0 || (b.onlinePaidAmount ?? 0) > 0) && (
                                <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                                  {(b.cashDepositPaidAmount ?? 0) > 0
                                    ? t('paidAtOffice', {
                                        amount: `${(b.cashDepositPaidAmount ?? 0).toLocaleString()} DZD`,
                                      })
                                    : t('paidOnline', {
                                        amount: `${(b.onlinePaidAmount ?? 0).toLocaleString()} DZD`,
                                      })}
                                </div>
                              )}
                              <div className={`text-xs font-normal ${awaitingCash ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                {awaitingCash
                                  ? t('balanceDue', { amount: `${balanceDue.toLocaleString()} DZD` })
                                  : t('balanceCollected', { amount: `${balanceDue.toLocaleString()} DZD` })}
                              </div>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">
                            {b.itemKind === 'SPACE' && (
                              <DownloadContractButton bookingId={b.id} templates={b.contractTemplates ?? []} />
                            )}
                            {(b.status === 'PENDING' || b.status === 'AWAITING_APPROVAL') && (
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
                            {b.status === 'PENDING_PAYMENT' && (
                              <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                                title={t('cancelUnpaid')}
                                disabled={busy === b.id}
                                onClick={() => cancelUnpaid(b.id)}>
                                <XCircle className="size-3.5" /> {t('cancelUnpaid')}
                              </Button>
                            )}
                            {b.status !== 'PENDING' && b.status !== 'CANCELLED' &&
                              b.status !== 'AWAITING_APPROVAL' && b.status !== 'APPROVED_UNPAID' && (
                              <Button size="icon" variant="ghost" title="View receipt"
                                onClick={() => setReceiptBookingId(b.id)}>
                                <ReceiptText className="size-4" />
                              </Button>
                            )}
                            {showDeleted ? (
                              <Button size="icon" variant="ghost" title={t('restore')}
                                disabled={busy === b.id}
                                onClick={() => restore(b.id)}>
                                <Undo2 className="size-4" />
                              </Button>
                            ) : (
                              // Only a booking holding no seat: a confirmed one
                              // is somebody's place and must be cancelled first.
                              bookingCanBeDeleted(b) && (
                                <Button size="icon" variant="ghost" title={t('delete')}
                                  className="text-destructive hover:text-destructive"
                                  disabled={busy === b.id}
                                  onClick={() => removeBooking(b.id)}>
                                  <Trash2 className="size-4" />
                                </Button>
                              )
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
